---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTをいつ使用するか、default、sparse、DOCモード、およびSchema Templateの間でどのように選択するか、そして設定をどこから始めるかの決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際は、このガイドを使用してください。以下のような質問に答えることができます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが非常にワイドな場合、デフォルト動作、sparse columns、またはDOCモードで開始すべきか？
- どの設定をデフォルトのままにして、どの設定を最初に変更すべきか？

既に`VARIANT`を使用したいことが分かっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選択する理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisが頻繁に使用されるパスに対してSubcolumnizationを適用できます。これにより、一般的なフィルター、集約、パスレベルのインデックスが、ドキュメントスキーマ全体を事前に固定することなく適切に機能します。非常にワイドなJSONでは、ストレージ層の最適化により、はるかに大きなパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

`VARIANT`は通常、以下の条件の大部分が当てはまる場合に適しています：

- 入力が、時間の経過とともにフィールドが進化するJSONまたはその他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- 列指向分析パフォーマンスを諦めることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的のままにできる。

以下の条件が主要な場合は、静的カラムを選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパスによる分析ではなく、生のJSONのアーカイブである。

## 最初に答える4つの質問

設定を触る前に、これら4つの質問に答えてください。

### 1. 明確なホットパスがありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、Dorisはそれらのパスに対してSubcolumnizationを適用し続けることができます。これは`VARIANT`が最も役立つところです。

### 2. 固定型または安定したインデックスが必要なパスがいくつかありますか？

はいの場合、それらのパスのみにSchema Templateを使用してください。これは少数のビジネス重要フィールド用であり、ドキュメント全体を記述するためのものではありません。

### 3. 本当にワイドなJSONになっていますか？

パス数が増え続け、メタデータ圧迫、コンパクション圧迫、または顕著なクエリオーバーヘッドを生み出し始めた場合、ワイドなJSONの問題があります。

### 4. ワイドなJSONの場合、何がより重要ですか：ホットパス分析か全ドキュメント返却か？

- 主な価値がホットフィールドでのパスベースフィルタリング、集約、インデックス化の場合は、sparse columnsに傾倒してください。
- 主な価値がインジェスト効率またはドキュメント全体の返却の場合は、DOCモードに傾倒してください。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization.** データが`VARIANT`カラムに書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列指向サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template.** 選択されたパスを安定した型に固定する`VARIANT`カラム上の宣言。型付き、インデックス可能、かつ予測可能でなければならない主要なビジネスフィールドに使用します。可能なすべてのパスを列挙しようとしないでください。

**Wide JSON.** 異なるパス数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を始めた場合、ワイドなJSONの問題があります。

**Sparse columns.** ワイドなJSONに明確なホット/コールドの分離がある場合、sparse columnsはホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有sparse storageに押し込みます。Sparse storageは、より良い読み取り並列性のために複数の物理カラム間でのシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示されているように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立した列指向サブカラムとして残り、数千のロングテールパスは共有sparse storageに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding.** ロングテールパス数が非常に大きい場合、単一のsparse columnが読み取りボトルネックになる可能性があります。Sparse shardingは、ロングテールパスをハッシュによって複数の物理カラム（`variant_sparse_hash_shard_count`）に分散し、並列スキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード.** 書き込み時にSubcolumnizationを遅延させ、さらに元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加のストレージを代価として、高速なインジェストと効率的な全ドキュメント返却を実現します。Subcolumnizationは後でコンパクション中に発生します。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示されているように、書き込み時にJSONは高速なインジェストのためにDoc Storeにそのまま保持されます。サブカラムは後でコンパクション中に抽出されます。読み取り時、パスベースクエリ（例：`SELECT v['user_id']`）は完全な列指向速度で実体化されたサブカラムから読み取り、全ドキュメントクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスが実体化されているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスが既にサブカラムに抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルトVARIANTと同じ完全な列指向速度で読み取り。
- **DOC Map**: クエリされたパスがまだ実体化されていない。クエリは値を見つけるためにdoc map全体をスキャンするフォールバックに戻る — ワイドなJSONでは大幅に遅い。
- **DOC Map (Sharded)**: 同じフォールバックだが、`variant_doc_hash_shard_count`でdoc mapが複数の物理カラムに分散され、並列スキャンとはるかに高速な回復が可能。

**Storage Format V3.** カラムメタデータをセグメントフッターから分離します。特にワイドなJSONでは、数千のサブカラムが存在する際のメタデータボトルネックを排除するため、すべての`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選択するには以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（ワイド、ホットパスが少ない） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先または全ドキュメント返却） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリがいくつかの馴染みのあるパスに繰り返しアクセスするイベントログまたは監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化するのに十分な幅があるかどうかまだ確信が持てず、ほとんどの価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点:
- パスの増大が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると利益なしに複雑性が増します。

### Sparseモード

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合はsparse columnsを選択してください。

典型例: 数千のオプション属性を持つが、定期的にクエリされるのは数十のみの広告、テレメトリ、またはプロファイルJSON。

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
総キー数が非常に大きいが、主要なワークロードがパスベースのフィルタリング、集約、インデックス作成である場合に使用してください。

注意点:
- ホットパス分析がボトルネックの場合は、まずDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これは既にほとんどのワークロードでの自動Subcolumnizationの適切な開始点です。事実上すべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を選択してください。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや、パスベース分析の最適化よりも取り込みオーバーヘッドの最小化が重要な場合は、DOCモードを選択してください。

典型例: モデル応答、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合:

- Subcolumnizationスケールが極端に大きくなる場合（10,000パスに近づく）、ハードウェア要件は急激に上昇します。この規模ではDOCモードがより安定した選択肢です。
- コンパクションメモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースな幅広カラムの取り込みワークロードでは、スループットが約5〜10倍向上する可能性があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムから文書を再構築することを避け、桁違いの高速化を実現します。

**はじめに:**

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
ingest スループットが最優先事項である場合、ワークロードで完全なJSONドキュメントを頻繁に取得する必要がある場合、または`SELECT variant_col`で非常に幅の広いカラムを頻繁に読み取る場合に使用します。

注意点：
- DOCモードは、すべての幅広JSONワークロードに対するデフォルトの解決策ではありません。ホットパス分析が支配的な場合、通常はsparse columnsの方が適しています。
- DOCモードとsparse columnsは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択します。

典型的な例：注文、支払い、またはデバイスペイロードで、いくつかのビジネスクリティカルなパスが型付けされ検索可能である必要がある場合。

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
少数のフィールドのみがビジネスクリティカルで、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。適切な場合は、Schema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON スキーマ全体を静的テンプレートに変換しないでください。それでは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的のままにしておく必要があります。

## パフォーマンス

以下のチャートは、10K パス幅のワイドカラムデータセット（20万行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較したものです。

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

- **Materialized subcolumnが最も高速です。** DefaultとDOC Materializedの両方で約76ms — 生のSTRINGより80倍高速、JSONBより12倍高速です。
- **DOC MapでのshardingがMaterializedされていないパスに効果的です。** doc mapのshardingにより、Materializedされていないパスのクエリ時間が2.5秒から148msに短縮されます。
- **JSONBとSTRINGはメモリを大量に消費します。** VARIANTモードの1 MiBに対して、32-48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルにはStorage Format V3から開始してください。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、ワイドJSONワークロードでファイル開放の遅延と高いメモリオーバーヘッドが発生します。
- **Schema Templateで主要パスを早期に固定してください。** Schema Templateがないと、システムは型を自動的に推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じてチューニングしてください。** ほとんどのワークロードでは、デフォルトで十分です。AI訓練、コネクテッドカー、ユーザータグシステムなどのワークロードで異常に大きなSubcolumnizationスケールと多数のパスレベルインデックスが必要な場合にのみ、シナリオ別にチューニングしてください。初日から過度に設定すること（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）は、メリットの証拠なしに複雑さを追加します。

### クエリフェーズ

- **非常にワイドな`VARIANT`カラムでは、`SELECT *`をメインのクエリパターンとして使用しないでください。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構成する必要があり、`SELECT v['path']`のようにパスを指定するよりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスをCASTしてください。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較する場合、インデックスが使用されず、結果が間違ってしまう可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視してください。** サブカラムの増加はマージコストを増加させます。Compaction Scoreが継続的に上昇している場合は、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎないかを確認してください。
- **スキーマドリフトを監視してください。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateでクリティカルパスをロックしてください。
- **型競合を監視してください。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるために、そのパスをSchema Templateでロックする必要があることを示しています。

## クイック検証

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
