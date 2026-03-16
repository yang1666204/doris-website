---
{
  "title": "POC開始前に",
  "language": "ja",
  "description": "Apache Dorisにおけるテーブル設計、データロード、およびクエリチューニングで新規ユーザーが遭遇する一般的な問題。",
  "sidebar_label": "Before You Start the POC"
}
---
# POCを開始する前に

このドキュメントでは、新規ユーザーが遭遇する可能性のある一般的な問題をハイライトし、POCプロセスの高速化を目的としています。

## テーブル設計

Dorisでテーブルを作成する際は、ロードとクエリのパフォーマンスに影響する4つの決定事項があります。

### データモデル

| データが... | 使用する | 理由 |
|---|---|---|
| 追記のみ（ログ、イベント、ファクト） | **Duplicate Key**（デフォルト） | すべての行を保持。最高のクエリパフォーマンス。 |
| プライマリキーによる更新（CDC、upsert） | **Unique Key** | 新しい行が同じキーを持つ古い行を置き換える。 |
| 事前集約されたメトリクス（PV、UV、合計） | **Aggregate Key** | 書き込み時にSUM/MAX/MINで行がマージされる。 |

**Duplicate Keyはほとんどのシナリオで動作します。** [Data Model Overview](../table-design/data-model/overview)を参照してください。

### ソートキー

最も頻繁にフィルタする列を最初に配置し、VARCHARの前に固定サイズ型（INT、BIGINT、DATE）を置いてください。Dorisはキー列の最初の36バイトで[prefix index](../table-design/index/prefix-index)を構築しますが、最初のVARCHARで停止します。高速フィルタリングが必要な他の列には[inverted indexes](../table-design/index/inverted-index/overview)を追加してください。

### パーティショニング

時間列がある場合は、`AUTO PARTITION BY RANGE(date_trunc(time_col, 'day'))`を使用して[partition pruning](../table-design/data-partitioning/auto-partitioning)を有効にしてください。Dorisは無関係なパーティションを自動的にスキップします。

### バケッティング

デフォルトは**Random bucketing**（Duplicate Keyテーブルに推奨）です。特定の列で頻繁にフィルタやジョインを行う場合は`DISTRIBUTED BY HASH(col)`を使用してください。[Data Bucketing](../table-design/data-partitioning/data-bucketing)を参照してください。

**バケット数の選択方法：**

1. **BE数の倍数**にしてデータ分散を均等にする。後でBEが追加された場合、クエリは通常複数のパーティションをスキャンするため、パフォーマンスが維持される。
2. **可能な限り低く**して小さなファイルを避ける。
3. **バケットあたりの圧縮データ ≤ 20 GB**（Unique Keyの場合は ≤ 10 GB）。`SHOW TABLETS FROM your_table`で確認してください。
4. **パーティションあたり128個以下。** より多く必要な場合は、まずパーティショニングを検討してください。

## サンプルテンプレート

### ログ / イベント分析

```sql
CREATE TABLE app_logs
(
    log_time      DATETIME    NOT NULL,
    log_level     VARCHAR(10),
    service_name  VARCHAR(50),
    trace_id      VARCHAR(64),
    message       STRING,
    INDEX idx_message (message) USING INVERTED PROPERTIES("parser" = "unicode")
)
AUTO PARTITION BY RANGE(date_trunc(`log_time`, 'day'))
()
DISTRIBUTED BY RANDOM BUCKETS 10;
```
### Upsert（CDC）を使用したリアルタイムダッシュボード

```sql
CREATE TABLE user_profiles
(
    user_id       BIGINT      NOT NULL,
    username      VARCHAR(50),
    email         VARCHAR(100),
    status        TINYINT,
    updated_at    DATETIME
)
UNIQUE KEY(user_id)
DISTRIBUTED BY HASH(user_id) BUCKETS 10;
```
### メトリクス集約

```sql
CREATE TABLE site_metrics
(
    dt            DATE        NOT NULL,
    site_id       INT         NOT NULL,
    pv            BIGINT      SUM DEFAULT '0',
    uv            BIGINT      MAX DEFAULT '0'
)
AGGREGATE KEY(dt, site_id)
AUTO PARTITION BY RANGE(date_trunc(`dt`, 'day'))
()
DISTRIBUTED BY HASH(site_id) BUCKETS 10;
```
## パフォーマンスの落とし穴

### ロード

- **一括データに`INSERT INTO VALUES`を使用しないでください。** 代わりに[Stream Load](../data-operate/import/import-way/stream-load-manual)または[Broker Load](../data-operate/import/import-way/broker-load-manual)を使用してください。[Loading Overview](../data-operate/import/load-manual)を参照してください。
- **クライアント側でバッチ書き込みを行ってください。** 高頻度の小さなインポートはバージョンの蓄積を引き起こします。実行できない場合は、[Group Commit](../data-operate/import/group-commit-manual)を使用してください。
- **大きなインポートをより小さなバッチに分割してください。** 失敗した長時間実行のインポートは最初から再開する必要があります。インクリメンタルインポートには[INSERT INTO SELECT with S3 TVF](../data-operate/import/streaming-job/streaming-job-tvf)を使用してください。
- **Randomバケッティングを使用するDuplicate Keyテーブルで`load_to_single_tablet`を有効にして**、書き込み増幅を削減してください。

[Load Best Practices](../data-operate/import/load-best-practices)を参照してください。

### クエリ

- **データスキュー。** `SHOW TABLETS`でタブレットサイズを確認してください。サイズが大幅に異なる場合は、Randomバケッティングまたはより高いカーディナリティのバケットカラムに切り替えてください。
- **間違ったソートキーの順序。** [Sort Key](#sort-key)を参照してください。

遅いクエリを診断するには[Query Profile](../query-acceleration/query-profile)を参照してください。
