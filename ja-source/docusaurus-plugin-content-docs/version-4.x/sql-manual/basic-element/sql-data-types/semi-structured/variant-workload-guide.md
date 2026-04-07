---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する判断ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に、このガイドを使用してください。以下のような質問に答える助けとなります：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが非常に幅広い場合、デフォルト動作、sparse columns、またはDOCモードのどれから始めるべきか？
- どの設定をデフォルトのまま残し、どの設定を最初に変更すべきか？

既に`VARIANT`を使用したいことが分かっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保持しますが、Dorisは頻繁に使用されるパスにSubcolumnizationを適用することができます。これにより、事前に文書スキーマ全体を固定することなく、一般的なフィルタ、集約、パスレベルのインデックスが適切に機能します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに多くのパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

以下のほとんどが当てはまる場合、`VARIANT`は通常良い選択肢です：

- 入力がJSONまたは時間と共にフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- カラム分析パフォーマンスを諦めることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、多くの他のパスは動的なままでよい。

以下の条件が支配的な場合は、静的カラムを選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別分析ではなく、生JSONのアーカイブである。

## まず4つの質問

設定に触れる前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、Dorisはそれらのパスに対してSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も役立つ場面です。

### 2. いくつかのパスに固定型または安定したインデックスが必要ですか？

はいの場合、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールド用であり、文書全体を記述するためのものではありません。

### 3. これは本当に幅広いJSONになっていますか？

パス数が増え続け、メタデータ圧迫、圧縮圧迫、または顕著なクエリオーバーヘッドを引き起こし始めると、幅広いJSONの問題が発生します。

### 4. 幅広いJSONの場合、ホットパス分析と文書全体の返却のどちらがより重要ですか？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集約、インデックスである場合は、sparse columnsに傾けてください。
- 主な価値が取り込み効率または文書全体の返却である場合は、DOCモードに傾けてください。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれるとき、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム状サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択したパスを安定した型に固定する`VARIANT`カラム上の宣言です。型付け、インデックス可能、予測可能である必要がある主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしてはいけません。

**Wide JSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、圧縮コスト、またはクエリコストの増加を開始すると、幅広いJSONの問題が発生します。

**Sparse columns。** 幅広いJSONに明確なホット/コールドの分離がある場合、sparse columnsはホットパスをSubcolumnizationに保持し、コールド（ロングテール）パスを共有sparse storageにプッシュします。Sparse storageは、より良い読み取り並列性のために複数の物理カラム間でのシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上記に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム状サブカラムとして留まり、数千のロングテールパスは共有sparse storageに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のsparseカラムが読み取りボトルネックになることがあります。Sparse shardingは、ロングテールパスをハッシュによって複数の物理カラム（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延し、さらに元のJSONをmap形式のストアドフィールド（**doc map**）として保存します。これにより、追加ストレージのコストと引き換えに、高速取り込みと効率的な文書全体の返却が可能になります。Subcolumnizationは圧縮中に後で発生します。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上記に示すように、書き込み中はJSONが高速取り込みのためにDoc Storeにそのまま保持されます。サブカラムは圧縮中に後で抽出されます。読み取り時には、パスベースのクエリ（例：`SELECT v['user_id']`）は完全なカラム速度で物理化されたサブカラムから読み取り、文書全体のクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスが物理化されているかどうかに応じて、3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスが既にサブカラムに抽出されています（圧縮後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルト`VARIANT`と同じ完全なカラム速度で読み取ります。
- **DOC Map**: クエリされたパスがまだ物理化されていません。クエリは値を見つけるためにdoc map全体のスキャンにフォールバックします — 幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**: 同じフォールバックですが、`variant_doc_hash_shard_count`でdoc mapが複数の物理カラムに分散され、並列スキャンとはるかに高速な復旧が可能になります。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。特に幅広いJSONで、数千のサブカラムが存在する場合にメタデータボトルネックを排除するため、すべての`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

以下の表を使用して開始点を選択し、対応するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを保持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパス少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（取り込み優先または文書全体返却） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（主要パスに安定した型が必要） | Schema Template + AまたはB | 主要パスのみを定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリが少数の馴染みのあるパスに繰り返しアクセするイベントログまたは監査ペイロード。

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
    "replication_num" = "1",
    "storage_format" = "V3"
);
```
ワークロードがsparse columnsやDOCモードを正当化するのに十分な幅があるかどうかまだ確実でなく、主な価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用します。

注意点：
- パスの増加が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると、利益なしに複雑さが増します。

### Sparseモード

ペイロードが幅広いが、ほとんどのクエリが少数のホットパスに焦点を当てている場合は、sparse columnsを選択します。

典型例：数千のオプション属性を持つが、定期的にクエリされるのは数十のみの広告、テレメトリ、またはプロファイルJSON。

```sql
CREATE TABLE IF NOT EXISTS telemetry_wide (
    ts DATETIME NOT NULL,
    device_id BIGINT NOT NULL,
    attributes VARIANT<
        'device_type' : STRING,
        'region' : STRING,
        properties(
            'variant_max_subcolumns_count' = '2048',
            'variant_sparse_hash_shard_count' = '64'
        )
    >
)
DUPLICATE KEY(`ts`, `device_id`)
DISTRIBUTED BY HASH(`device_id`) BUCKETS 32
PROPERTIES (
    "replication_num" = "1",
    "storage_format" = "V3"
);
```
主なワークロードがパスベースのフィルタリング、集約、インデックスである場合に、総キー数が非常に大きい時に使用してください。

注意事項：
- ホットパス分析がボトルネックの場合は、最初にDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードにおいて自動Subcolumnizationの適切な開始点です。すべてのパスが実質的にSubcolumnizationを通過するほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を推奨します。

### DOC Mode {#doc-mode-template}

パスベース分析の最適化よりも、JSON文書全体を返すことやingestオーバーヘッドの最小化が重要な場合は、DOCモードを選択してください。

典型的な例：モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードは以下の場合に有効です：

- Subcolumnizationスケールが非常に大規模になる（約10,000パスに近づく）場合、ハードウェア要件が急速に上昇します。この規模では、DOCモードがより安定した選択肢です。
- コンパクションメモリは、デフォルトのeager Subcolumnizationと比較して約3分の2減少させることができます。
- スパースなワイドカラムingestionワークロードでは、スループットが約5～10倍改善できます。
- クエリが`VARIANT`値全体を読み取る（`SELECT variant_col`）場合、DOCモードは数千のサブカラムからの文書再構築を回避し、桁違いの高速化を実現します。

**開始方法：**

```sql
CREATE TABLE IF NOT EXISTS trace_archive (
    ts DATETIME NOT NULL,
    trace_id VARCHAR(64) NOT NULL,
    span VARIANT<
        'service_name' : STRING,
        properties(
            'variant_enable_doc_mode' = 'true',
            'variant_doc_materialization_min_rows' = '10000',
            'variant_doc_hash_shard_count' = '64'
        )
    >
)
DUPLICATE KEY(`ts`, `trace_id`)
DISTRIBUTED BY HASH(`trace_id`) BUCKETS 32
PROPERTIES (
    "replication_num" = "1",
    "storage_format" = "V3"
);
```
ingest スループットが最優先である場合、ワークロードで完全な JSON ドキュメントを頻繁に取得する必要がある場合、または非常に幅の広いカラムを `SELECT variant_col` で読み取ることが多い場合に使用します。

注意点：
- DOC モードは、すべての幅広 JSON ワークロードに対するデフォルトの解決策ではありません。ホットパス分析が主要な場合は、通常はスパースカラムの方が適しています。
- DOC モードとスパースカラムは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は Schema Template を選択します。

典型的な例：注文、支払い、またはデバイスのペイロードで、いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
    "replication_num" = "1",
    "storage_format" = "V3"
);
```
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやpath-levelインデックス戦略が必要な場合に使用してください。適切な場合は、Schema Templateをsparse columnsまたはデフォルトの`VARIANT`と組み合わせます。

注意点：
- JSON schema全体を静的テンプレートにしないでください。それでは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的なままにしておく必要があります。

## Performance

下記のチャートは、10K-path wide-columnデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）における単一パス抽出時間を比較したものです。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time.svg)

| Mode | Query Time | Peak Memory |
|---|---:|---:|
| DOC Materialized | 76 ms | 1 MiB |
| VARIANT Default | 76 ms | 1 MiB |
| DOC Map (Sharded) | 148 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| DOC Map | 2,533 ms | 1 MiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

主なポイント：

- **Materialized subcolumnsが勝者です。**DefaultとDOC Materializedの両方が約76msを達成—生のSTRINGより80倍高速、JSONBより12倍高速です。
- **DOC Map with shardingが有効です。**doc mapをshardingすることで、un-materializedパスのクエリ時間が2.5秒から148msに短縮されます。
- **JSONBとSTRINGはメモリを大量消費します。**VARIANTモードの1 MiBに対し、32–48 GiBのピークメモリを消費します。

## Best Practices

### Import Phase

- **新しい`VARIANT`テーブルにはStorage Format V3から始めてください。**V3はcolumn metadataをsegment footerから分離します。これがないと、wide JSON workloadsではファイルオープンが遅く、メモリオーバーヘッドが高くなります。
- **Schema Templateを使用して早期にキーパスを固定してください。**Schema Templateがないと、システムは型を自動推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格し、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状に応じてチューニングしてください。**ほとんどのワークロードでは、デフォルトで十分です。AI training、connected vehicles、user-tagシステムなど、異常に大きなSubcolumnizationスケールと多くのpath-levelインデックスが必要なワークロードの場合のみ、シナリオ別にチューニングしてください。初日から過度に設定する（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）と、効果の証拠なしに複雑さが増します。

### Query Phase

- **非常に幅の広い`VARIANT`カラムに対して`SELECT *`をメインのクエリパターンとして使用しないでください。**DOCモードなしでは、`SELECT *`や`SELECT variant_col`はすべてのsubcolumnsから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパスを指定するよりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にsubpathsをCASTしてください。**型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして保存されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違っている可能性があります。

### Operations Phase

- **compaction pressureを監視してください。**Subcolumnの増加はmergeコストを増大させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **schema driftを監視してください。**JSON構造が頻繁に変更される場合、ホットパスがsparse storageに押し込まれ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視してください。**同じパスで頻繁に型競合が発生する場合、JSONB昇格とインデックス喪失を避けるため、Schema Templateを使用してそのパスをロックする必要があります。

## Quick Verify

テーブル作成後、すべてが正常に動作することを確認するために、この最小限のシーケンスを使用してください：

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
- [Storage Format V3](../../../../table-design/storage-format)
- [SEARCH Function](../../../../ai/text-search/search-function)
