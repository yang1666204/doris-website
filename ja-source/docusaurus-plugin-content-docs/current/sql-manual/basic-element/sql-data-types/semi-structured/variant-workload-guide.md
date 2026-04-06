---
{
  "title": "VARIANTワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、そして設定の開始点に関する判断ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

このガイドは新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に使用してください。次のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`と静的カラムのどちらを使用すべきか？
- JSONが非常に幅広い場合、デフォルト動作、スパースカラム、DOCモードのいずれから始めるべきか？
- どの設定をデフォルトのままにし、どの設定を最初に変更すべきか？

すでに`VARIANT`を使用することが決まっており、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)に進んでください。実行可能な最小限のインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)に進んでください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisは頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、ドキュメント全体のスキーマを事前に固定することなく、一般的なフィルター、集計、パスレベルのインデックスが適切に機能します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに多くのパス数でSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

`VARIANT`は通常、以下の条件の大部分が真である場合に適しています：

- 入力がJSONまたは時間の経過とともにフィールドが変化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- カラム型分析のパフォーマンスを諦めることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的のままで良い。

次の条件が支配的である場合は静的カラムを選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパスごとの分析ではなく、生のJSONをアーカイブすることである。

## 最初に答える4つの質問

設定に触れる前に、これら4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、DorisはそれらのパスにSubcolumnizationを継続的に適用できます。これが`VARIANT`が最も役立つ場面です。

### 2. 一部のパスで固定型または安定したインデックスが必要ですか？

必要な場合は、それらのパスのみにSchema Templateを使用してください。これはドキュメント全体を記述するためではなく、少数のビジネスクリティカルなフィールドのために設計されています。

### 3. これは本当に幅広いJSONになっていますか？

パス数が増え続け、メタデータの負荷、コンパクション負荷、または顕著なクエリオーバーヘッドを生成し始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、何がより重要ですか：ホットパス分析またはドキュメント全体の返却？

- 主な価値がホットフィールドでのパスベースフィルタリング、集計、インデックスである場合は、スパースカラムに傾倒する。
- 主な価値が取り込み効率またはドキュメント全体の返却である場合は、DOCモードに傾倒する。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています；実装の詳細については[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれるとき、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** `VARIANT`カラムに対する宣言で、選択されたパスを安定した型に固定します。型付き、インデックス可能、予測可能であることが必要な主要なビジネスフィールドに使用してください。可能なすべてのパスを列挙しようとしてはいけません。

**幅広いJSON。** 個別のパス数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を始めた場合、幅広いJSONの問題があります。

**スパースカラム。** 幅広いJSONに明確なホット/コールドの分離がある場合、スパースカラムはホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有スパースストレージに押し込みます。スパースストレージは、より良い読み取り並列処理のために複数の物理カラム間でのシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして残り、一方で数千のロングテールパスは共有スパースストレージに収束します。しきい値は`variant_max_subcolumns_count`で制御されます。

**スパースシャーディング。** ロングテールパス数が非常に大きい場合、単一のスパースカラムが読み取りのボトルネックになる可能性があります。スパースシャーディングは、ロングテールパスをハッシュによって複数の物理カラム（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延させ、さらに元のJSONをmap形式の格納フィールド（**docマップ**）として保存します。これにより、追加のストレージコストと引き換えに、高速な取り込みと効率的なドキュメント全体の返却を提供します。Subcolumnizationは後でコンパクション中に実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図のように、書き込み時にJSONは高速取り込みのためにそのままDoc Storeに保存されます。サブカラムは後でコンパクション中に抽出されます。読み取り時、パスベースクエリ（例：`SELECT v['user_id']`）は完全なカラム型速度でマテリアライズされたサブカラムから読み取り、ドキュメント全体クエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスがマテリアライズされているかどうかに応じて、3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**：クエリされたパスがすでにサブカラムに抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトVARIANTと同じ完全なカラム型速度で読み取ります。
- **DOC Map**：クエリされたパスがまだマテリアライズされていない。クエリは値を見つけるためにdocマップ全体のスキャンにフォールバックします — 幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**：同じフォールバックですが、`variant_doc_hash_shard_count`でdocマップが複数の物理カラムに分散され、並列スキャンとはるかに高速なリカバリが可能になります。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。特に幅広いJSONの場合、数千のサブカラムが存在するときのメタデータボトルネックを排除するため、あらゆる`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために下表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広、ホットパスは少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（取り込み優先またはドキュメント全体返却） | DOC mode + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（主要パスに安定した型が必要） | Schema Template + AまたはB | 主要パスのみを定義 |

### デフォルトモード

これは新しい`VARIANT`ワークロードの多くにとって最も安全な開始点です。

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
    "replication_num" = "1",
    "storage_format" = "V3"
);
```
ワークロードがsparse columnsやDOC modeを正当化するのに十分な幅があるかどうかまだ確信が持てず、ほとんどの価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点：
- パスの増大が既に圧迫を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOC modeを有効にすると利益なしに複雑性が増します。

### Sparse Mode

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに集中している場合は、sparse columnsを選択してください。

典型的な例：何千ものオプション属性を持つが、定期的にクエリされるのは数十個のみの広告、テレメトリ、またはプロファイルJSON。

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
総キー数が非常に大きいが、主要なワークロードがパスベースのフィルタリング、集約、およびインデックス作成である場合に使用します。

注意点:
- ホットパス分析がボトルネックになっている場合は、まずDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルト値は`2048`で、これは既にほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOCモード](#doc-mode-template)を推奨します。

### DOCモード {#doc-mode-template}

JSON文書全体を返すことや取り込みオーバーヘッドの最小化が、パス ベース分析の最適化よりも重要な場合にDOCモードを選択します。

典型的な例: モデル応答、トレーススナップショット、または完全なペイロードとして頻繁に返されるアーカイブされたJSON文書。

DOCモードが有効な場合:

- Subcolumnizationスケールが極端に大きくなる場合（10,000パスに近づく）、ハードウェア要件が急速に増加します。DOCモードはこのスケールでより安定した選択です。
- コンパクションメモリは、デフォルトの積極的なSubcolumnizationと比較して約3分の2削減できます。
- スパースな幅広カラムの取り込みワークロードでは、スループットが約5～10倍改善できます。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムからの文書再構築を回避し、桁違いの高速化を実現します。

**始め方:**

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
ingestのスループットが最優先である場合、ワークロードが完全なJSONドキュメントの返却を頻繁に必要とする場合、または非常に幅の広いカラムが`SELECT variant_col`で頻繁に読み取られる場合に使用してください。

注意点：
- DOCモードは、すべての幅の広いJSONワークロードのデフォルトの答えではありません。ホットパス分析が主要な場合、sparse columnsの方が通常適しています。
- DOCモードとsparse columnsは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択してください。

典型的な例：いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要があるorder、payment、またはdeviceペイロード。

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
ビジネスクリティカルなフィールドが少数で、それらのパスにより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。適切な場合はSchema Templateをsparse columnsやデフォルトの`VARIANT`と組み合わせます。

注意点：
- JSON schema全体を静的なテンプレートに変換しないでください。それでは`VARIANT`の意味がなくなります。
- Schema Templateは重要なパスのみをカバーし、残りは動的のままにしておきます。

## Performance

以下のチャートは、10K-path wide-columnデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）でのsingle-path抽出時間を比較したものです。

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

主な要点：

- **Materialized subcolumnsが最高性能。** DefaultとDOC Materializedの両方が約76 ms — 生のSTRINGより80倍高速、JSONBより12倍高速。
- **DOC Mapとshardingによりパフォーマンスが向上。** doc mapをshardingすることで、un-materializedパスのクエリ時間が2.5秒から148 msに短縮されます。
- **JSONBとSTRINGはメモリを大量消費。** VARIANTモードの1 MiBに対して32–48 GiBのピークメモリを消費します。

## Best Practices

### Import Phase

- **新しい`VARIANT`テーブルにはStorage Format V3から開始してください。** V3はcolumn metadataをsegment footerから分離します。これがないと、wide JSON workloadはファイルオープンが遅く、メモリオーバーヘッドが高くなります。
- **Schema Templateを使用して早期に重要なパスを固定してください。** Schema Templateがないと、システムは自動的に型を推論します。同じパスがバッチ間で型を変更した場合（例：integerからstring）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整してください。** ほとんどのworkloadでは、デフォルトで十分です。AI training、connected vehicles、user-tagシステムなどのworkloadで異常に大きなSubcolumnizationスケールと多くのpath-levelインデックスが必要な場合のみ、シナリオに応じて調整してください。初日から過度の設定（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）は、利益の証拠なしに複雑さを追加します。

### Query Phase

- **非常に幅広い`VARIANT`カラムのメインクエリパターンとして`SELECT *`を使用しないでください。** DOCモードがなければ、`SELECT *`や`SELECT variant_col`はすべてのsubcolumnから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にsubpathをCASTしてください。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして保存されているのに整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### Operations Phase

- **compaction pressureを監視してください。** Subcolumnの増加はmergeコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、ingestion rateが速すぎるかを確認してください。
- **schema driftを監視してください。** JSON構造が頻繁に変更される場合、ホットパスがsparse storageに押し込まれ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型の競合を監視してください。** 同じパスでの頻繁な型競合は、そのパスがSchema Templateでロックされ、JSONB昇格とインデックス喪失を避けるべきであることを示しています。

## Quick Verify

テーブル作成後、すべてが正常に動作することを確認するために、以下の最小限のシーケンスを使用してください：

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
