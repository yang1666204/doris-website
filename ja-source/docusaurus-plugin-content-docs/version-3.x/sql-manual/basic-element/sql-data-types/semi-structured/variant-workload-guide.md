---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xにおいてVARIANTを使用するタイミング、sparse columnsを有効化するタイミング、およびSchema TemplateやPath固有のインデックスを追加するタイミングの決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

このガイドは、Doris 3.xで新しい`VARIANT`ワークロードを計画している際に使用します。以下のような疑問に答えるのに役立ちます：

- このワークロードでは`VARIANT`か静的カラムのどちらを使用すべきか？
- JSONが広くなっている場合、デフォルト動作を維持すべきか、それともスパースカラムを有効にすべきか？
- いつSchema Templateやパス固有のインデックスを追加すべきか？

既に`VARIANT`を使用することが決まっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、DorisがSubcolumnizationを頻繁に使用されるパスに適用することを可能にします。Doris 3.1以降では、広いJSONでもホットパスをSubcolumnizationに保持し、ロングテールパスをスパースストレージに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.x機能境界
このガイドはDoris 3.xで利用可能な機能のみをカバーします。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、およびパス固有のインデックスは、Doris 3.1.0以降が必要です。新しいバージョンのDOCモードガイダンスは、Doris 3.xには適用されません。
:::

## VARIANTが適している場合

以下のすべてまたは大部分が当てはまる場合は`VARIANT`を使用します：

- 入力がJSONまたは時間の経過とともにフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- カラム分析パフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が優勢な場合は静的カラムを選択してください：

- スキーマが安定していて、事前に既知である。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件が、パス別の分析ではなく、生のJSONのアーカイブやドキュメント全体の頻繁な返却である。

## 主要概念

以下のストレージモードを読む前に、これらの用語を明確にしておいてください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template (3.1+)。** 選択されたパスを安定した型に固定する`VARIANT`カラムの宣言。型付け、インデックス可能、および予測可能である必要がある重要なビジネスフィールドに使用します。すべての可能なパスを列挙しようとしてはいけません。

**Wide JSON。** 異なるパスの数が継続的に増加し、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストを増加させ始める場合、wide-JSONの問題があります。

**スパースカラム (3.1+)。** 広いJSONに明確なホット/コールドの分離がある場合、スパースカラムはホットパスをSubcolumnizationに保持し、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するには`variant_max_subcolumns_count`を使用します。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして維持され、数千のロングテールパスは共有スパースストレージに収束されます。閾値は`variant_max_subcolumns_count`によって制御されます。

## 推奨決定パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリがドキュメント全体を返す広いJSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択ではありません。非常に広いカラムで`SELECT variant_col`を主要なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト設定が既に適切な開始点です。アクセスパターンが明らかに異常な場合にのみ調整してください。典型的な例には、AIトレーニング機能ペイロード、接続車両テレメトリー、およびDoris 3.1以降で異常に大規模なSubcolumnizationと多くのパスレベルインデックスが必要なユーザータグシステムが含まれます。

## ストレージモード

開始点を選ぶために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | デフォルトVARIANT | デフォルトを維持 |
| **B** | 広告/テレメトリー/ユーザープロファイル（広い、ホットパスが少ない） | スパース (3.1+) | `variant_max_subcolumns_count` |
| **C** | 注文/支払い/デバイス（キーパスが安定した型を必要とする） | Schema Template (3.1+) + AまたはB | キーパスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリが少数の馴染みのあるパスに繰り返しアクセスするイベントログや監査ペイロード。

```sql
CREATE TABLE IF NOT EXISTS event_log (
    ts DATETIME NOT NULL,
    event_id BIGINT NOT NULL,
    event_type VARCHAR(64),
    payload VARIANT
)
DUPLICATE KEY(`ts`, `event_id`)
DISTRIBUTED BY HASH(`event_id`) BUCKETS 16
PROPERTIES (
    "replication_num" = "1"
);
```
ワークロードがsparse columnsを正当化するのに十分広いかどうかまだ確信が持てず、依然として複数の共通パスでのフィルタリング、集約、グループ化から最大の価値が得られる場合に使用してください。

注意点：
- パスの増加が既に負荷の原因となっていない限り、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが広くない場合、sparse columnsを有効にすると利益なしに複雑性が増します。

### Sparseモード

> このテンプレートはDoris 3.1.0以降が必要です。

ペイロードが広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合にsparse columnsを選択してください。

典型例：数千のオプション属性を持つが定期的にクエリされるのは数十のみの広告、テレメトリ、またはプロファイルJSON。

```sql
CREATE TABLE IF NOT EXISTS telemetry_wide (
    ts DATETIME NOT NULL,
    device_id BIGINT NOT NULL,
    attributes VARIANT<
        'device_type' : STRING,
        'region' : STRING,
        properties(
            'variant_max_subcolumns_count' = '2048',
            'variant_enable_typed_paths_to_sparse' = 'true'
        )
    >
)
DUPLICATE KEY(`ts`, `device_id`)
DISTRIBUTED BY HASH(`device_id`) BUCKETS 32
PROPERTIES (
    "replication_num" = "1"
);
```
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、およびインデックス作成である場合に使用してください。

注意点:
- ホットパス分析がボトルネックの場合、スパース列が3.xでの正しい方向です。
- `variant_max_subcolumns_count`を大きく設定しすぎて、事実上すべてのパスがSubcolumnizationを通るようにしないでください。これは目的に反し、メタデータと圧縮コストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合はSchema Templateを選択してください。

典型的な例: 注文、支払い、またはデバイスペイロードで、いくつかのビジネスクリティカルなパスが型付けされ検索可能な状態を維持する必要がある場合。

```sql
CREATE TABLE IF NOT EXISTS order_events (
    ts DATETIME NOT NULL,
    order_id BIGINT NOT NULL,
    detail VARIANT<
        'status' : STRING,
        'amount' : DECIMAL(18, 2),
        'currency' : STRING
    >,
    INDEX idx_status(detail) USING INVERTED PROPERTIES("field_pattern" = "status")
)
DUPLICATE KEY(`ts`, `order_id`)
DISTRIBUTED BY HASH(`order_id`) BUCKETS 16
PROPERTIES (
    "replication_num" = "1"
);
```
ビジネスクリティカルなフィールドが少数で、それらのパスにより厳密な型指定やパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合は、Schema Templateをスパース列やデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON スキーマ全体を静的テンプレートに変換しないでください。それでは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的なままにしておきます。

## パフォーマンス

以下のチャートは、10K パス幅のワイドカラムデータセット（200K 行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較したものです。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| モード | クエリ時間 | ピークメモリ |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

重要なポイント：

- **VARIANT Defaultが最速です。** 76 ms — JSONBより12倍高速、生のSTRINGより80倍高速。
- **JSONBとSTRINGはメモリを大量消費します。** VARIANTの1 MiBに対し、32–48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **Schema Templateを使用して主要パスを早期に固定（3.1+）。** Schema Templateがない場合、システムは自動的に型を推論します。同じパスがバッチ間で型を変更した場合（例：整数から文字列）、JSONBに昇格され、そのパス上のインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整。** ほとんどのワークロードでは、デフォルトで十分です。AIトレーニング、コネクテッドビークル、ユーザータグシステムなどのワークロードが異常に大規模なSubcolumnizationスケールとDoris 3.1以降での多数のパスレベルインデックスを必要とする場合のみ、シナリオに応じて調整してください。初日から過度に設定すること（非常に大きな`variant_max_subcolumns_count`）は、利益の根拠なしに複雑さを追加します。

### クエリフェーズ

- **非常に幅の広い`VARIANT`列に対するメインクエリパターンとして`SELECT *`を使用しないでください。** Doris 3.xにはDOCモードがないため、`SELECT *`や`SELECT variant_col`はすべてのサブ列からJSONを再構築する必要があり、幅の広い列では非常にコストがかかります。
- **クエリが型に依存する場合は、常にサブパスをCASTしてください。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較する場合、インデックスは使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視してください。** サブ列の増大はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **スキーマドリフトを監視してください。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージに押し込まれ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視してください。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるために、そのパスをSchema Templateでロックすべきであることを示しています。

## クイック検証

テーブルを作成した後、すべてが機能することを確認するためにこの最小限のシーケンスを使用してください：

```sql
-- Insert sample data
INSERT INTO event_log VALUES
    ('2025-01-01 10:00:00', 1001, 'click', '{"page": "home", "user_id": 42, "duration_ms": 320}'),
    ('2025-01-01 10:00:01', 1002, 'purchase', '{"item": "widget", "price": 9.99, "user_id": 42}'),
    ('2025-01-01 10:00:02', 1003, 'click', '{"page": "search", "user_id": 99, "query": "doris variant"}');

-- Verify data
SELECT payload['user_id'], payload['page'] FROM event_log;

-- Check Subcolumnization results
SET describe_extend_variant_column = true;
DESC event_log;

-- Check per-row types
SELECT variant_type(payload) FROM event_log;
```
## 関連資料

- [VARIANT](./VARIANT)
- [Import Variant Data](../../../../data-operate/import/complex-types/variant)
- [Inverted Index](../../../../table-design/index/inverted-index)
- [Full-Text Search Operators](../../operators/conditional-operators/full-text-search-operators)
