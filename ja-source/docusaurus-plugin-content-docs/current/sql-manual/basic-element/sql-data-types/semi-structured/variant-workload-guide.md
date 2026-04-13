---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

このガイドは新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に使用してください。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的列を使用すべきか？
- JSONが非常に幅広い場合、デフォルトの動作、sparse columns、またはDOCモードから開始すべきか？
- どの設定をデフォルトのままにして、どの設定を最初に変更すべきか？

すでに`VARIANT`を使用したいことが分かっており、構文や型のルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisは頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、文書スキーマ全体を事前に固定することなく、一般的なフィルタ、集約、パスレベルのインデックスが適切に機能します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに多くのパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

通常、以下の条件の大部分が当てはまる場合、`VARIANT`は適しています：

- 入力がJSONまたは時間の経過とともにフィールドが進化するその他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- 列型分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要で、多くの他のパスは動的のままにできる。

以下の条件が優勢な場合は静的列を選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される。
- 主な要件は、パスによる分析ではなく、生のJSONをアーカイブすることである。

## 最初の4つの質問

設定を触る前に、これらの4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、Dorisはそれらのパスに対してSubcolumnizationを継続的に適用できます。これが`VARIANT`が最も役立つ場面です。

### 2. 固定型または安定したインデックスが必要な少数のパスはありますか？

はいの場合、それらのパスのみにSchema Templateを使用してください。これは文書全体を記述するためではなく、少数のビジネスクリティカルなフィールドのためのものです。

### 3. これは本当に幅広いJSONになっていますか？

パス数が増え続け、メタデータの負荷、コンパクション負荷、または顕著なクエリオーバーヘッドを生み出し始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、何がより重要ですか：ホットパス分析か文書全体の戻り値か？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集約、インデックスである場合は、sparse columnsに向かってください。
- 主な価値が取り込み効率または文書全体の戻り値である場合は、DOCモードに向かってください。

## 主要な概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** `VARIANT`列にデータが書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`列の宣言。型付き、インデックス可能、予測可能である必要がある主要なビジネスフィールドに使用してください。可能なすべてのパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストを増加させ始めた場合、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールドの分離がある場合、sparse columnsはホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有sparse storageにプッシュします。Sparse storageは、より良い読み取り並列性のために複数の物理列にわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立した列型サブカラムとして残り、数千のロングテールパスは共有sparse storageに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のsparse columnが読み取りボトルネックになる可能性があります。Sparse shardingは、ロングテールパスをハッシュによって複数の物理列（`variant_sparse_hash_shard_count`）に分散させ、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延させ、さらに元のJSONをマップ形式の格納フィールド（**doc map**）として格納します。これにより、追加のストレージのコストで高速な取り込みと効率的な文書全体の戻り値を提供します。Subcolumnizationはコンパクション中に後で行われます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み中にJSONは高速な取り込みのためにDoc Storeにそのまま保存されます。サブカラムはコンパクション中に後で抽出されます。読み取り時には、パスベースのクエリ（例：`SELECT v['user_id']`）は完全な列型速度で実体化されたサブカラムから読み取り、文書全体のクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOCモードは、クエリされたパスが実体化されているかどうかに応じて3つの異なる読み取りパスを持ちます：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスがすでにサブカラムに抽出されています（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルトのVARIANTと同じ完全な列型速度で読み取ります。
- **DOC Map**: クエリされたパスがまだ実体化されていません。クエリは値を見つけるためにdoc map全体をスキャンすることにフォールバックします — 幅広いJSONでは著しく遅くなります。
- **DOC Map (Sharded)**: 同じフォールバック。ただし、`variant_doc_hash_shard_count`を使用してdoc mapが複数の物理列に分散され、並列スキャンとはるかに高速な回復が可能になります。

**Storage Format V3。** 列のメタデータをセグメントフッターから分離します。特に幅広いJSONにおいて、数千のサブカラムが存在する場合のメタデータボトルネックを排除するため、すべての`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選択するには以下の表を使用し、対応するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパスは少ない） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（取り込み優先または文書全体の戻り値） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（主要パスに安定した型が必要） | Schema Template + AまたはB | 主要パスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な出発点です。

典型例：クエリが少数の馴染みのあるパスに繰り返しアクセスするイベントログまたは監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化するほど幅広いかどうかまだ確信が持てず、大部分の価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点：
- パスの増加が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると利益なしに複雑性が増します。

### Sparseモード

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合にsparse columnsを選択してください。

典型的な例：数千のオプション属性を持つが、定期的にクエリされるのは数十のみである広告、テレメトリ、またはプロファイルJSON。

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
総キー数が非常に大きいが、主要なワークロードがパスベースのフィルタリング、集計、インデックス作成である場合に使用します。

注意点：
- ホットパス分析がボトルネックの場合は、まずDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルト値は`2048`で、これはほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。すべてのパスが実質的にSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を優先してください。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すこと、またはパスベース分析の最適化よりも取り込みオーバーヘッドの最小化が重要な場合は、DOCモードを選択してください。

典型的な例：モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合：

- Subcolumnizationスケールが非常に大きくなる場合（10,000パスに近づく場合）、ハードウェア要件が急速に高くなります。この規模では、DOCモードがより安定した選択です。
- コンパクション メモリは、デフォルトの積極的なSubcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5～10倍向上する可能性があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムから文書を再構成することを回避し、桁違いの高速化を実現します。

**はじめに：**

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
ingest スループットが最優先である場合、ワークロードで完全な JSON ドキュメントを頻繁に取得する必要がある場合、または非常に幅の広いカラムを `SELECT variant_col` で読み取ることが多い場合に使用してください。

注意点：
- DOC mode は、すべての wide-JSON ワークロードのデフォルトの解決策ではありません。ホットパス分析が主である場合、通常はスパースカラムの方が適しています。
- DOC mode とスパースカラムは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合に Schema Template を選択してください。

典型的な例：注文、支払い、またはデバイスペイロードにおいて、いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。必要に応じてSchema Templateをスパース列やデフォルトの`VARIANT`と組み合わせます。

注意点：
- JSON スキーマ全体を静的テンプレートにしないでください。それでは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的のままにしておきます。

## パフォーマンス

以下のグラフは、10K パス幅の wide-column データセット（20万行、1つのキーを抽出、16 CPU、3回実行の中央値）でのシングルパス抽出時間を比較しています。

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

- **マテリアライズされたサブカラムが最優秀。** DefaultとDOC Materializedの両方が約76 ms を実現 — 生のSTRINGより80倍速く、JSONBより12倍速い。
- **DOC Mapはシャーディングによって改善。** doc mapをシャーディングすることで、非マテリアライズパスのクエリ時間が2.5秒から148 msに短縮される。
- **JSONBとSTRINGはメモリ消費が大きい。** VARIANTモードの1 MiBに対し、32–48 GiBのピークメモリを消費する。

## ベストプラクティス

### インポート段階

- **新しい`VARIANT`テーブルにはStorage Format V3から開始する。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、幅の広いJSONワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが高くなります。
- **Schema Templateによって早期に主要パスを固定する。** Schema Templateがない場合、システムは型を自動的に推論します。同じパスがバッチ間で型が変わる場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI トレーニング、コネクテッドビークル、ユーザータグシステムなどのワークロードで異常に大規模なSubcolumnizationスケールと多くのパスレベルインデックスが必要な場合のみ、シナリオに応じて調整してください。初日から過度に設定する（非常に大きな`variant_max_subcolumns_count`、不要なときのDOCモード有効化）と、利益の証拠なしに複雑さを追加します。

### クエリ段階

- **非常に幅の広い`VARIANT`カラムに対して`SELECT *`をメインのクエリパターンとして使用しない。** DOCモードがない場合、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は、サブパスを常にCASTする。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているが整数リテラルと比較する場合、インデックスが使用されず結果が間違う可能性があります。

### 運用段階

- **コンパクション圧力を監視する。** サブカラムの増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかをチェックしてください。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージに押し込まれ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視する。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス喪失を避けるためにSchema Templateでそのパスをロックすべきことを示しています。

## クイック検証

テーブル作成後、すべてが機能することを確認するために、この最小限のシーケンスを使用してください：

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
