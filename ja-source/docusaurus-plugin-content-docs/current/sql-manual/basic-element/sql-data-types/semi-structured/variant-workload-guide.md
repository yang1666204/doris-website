---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTをいつ使用するか、default、sparse、DOCモード、Schema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードのモデリング方法を決定する際に使用してください。以下のような質問への回答を支援します：

- このワークロードは`VARIANT`を使用すべきか、それとも静的列を使用すべきか？
- JSONが非常に幅広い場合、デフォルトの動作、スパース列、またはDOCモードのどれから始めるべきか？
- どの設定をデフォルトのままにし、どれを最初に変更すべきか？

既に`VARIANT`を使用したいことが分かっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。実行可能な最小のインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保持しますが、Dorisは頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、ドキュメントスキーマ全体を事前に固定することなく、一般的なフィルタ、集約、パスレベルのインデックスが適切に機能します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに多くのパス数でSubcolumnizationが実用的になります。
:::

## VARIANTが適用される場面

`VARIANT`は、通常、以下のほとんどが当てはまる場合に適しています：

- 入力がJSONまたはフィールドが時間とともに変化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- 列指向分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要。
- 一部のパスはインデックス化が必要だが、他の多くのパスは動的なままでよい。

以下の条件が支配的な場合は静的列を選択してください：

- スキーマが安定しており、事前に既知である。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される。
- 主な要件がパス別の分析ではなく、生JSONのアーカイブである。

## 最初の4つの質問

設定を触る前に、これら4つの質問に答えてください。

### 1. 明確なホットパスは存在するか？

クエリが同じJSONパスを繰り返し触れる場合、Dorisはそれらのパスに対してSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も役立つ場面です。

### 2. 少数のパスに固定された型や安定したインデックスが必要か？

必要な場合は、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールド用であり、ドキュメント全体を記述するためのものではありません。

### 3. これは実際に幅広いJSONになっているか？

パス数が増え続け、メタデータ圧迫、コンパクション圧迫、または顕著なクエリオーバーヘッドを作り始める場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、何がより重要か：ホットパス分析か全ドキュメント返却か？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集約、インデックス化である場合は、スパース列に傾く。
- 主な価値がインジェスト効率または全ドキュメントの返却である場合は、DOCモードに傾く。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`列に書き込まれるとき、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列指向サブ列として抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** `VARIANT`列の宣言で、選択されたパスを安定した型に固定します。型付け、インデックス化、および予測可能性が必要な主要ビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパス数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を引き起こし始める場合、幅広いJSONの問題があります。

**スパース列。** 幅広いJSONに明確なホット/コールドの分離がある場合、スパース列はホットパスをSubcolumnizationに保持しながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。スパースストレージは、読み取り並列性を向上させるために複数の物理列間でシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上記のように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立した列指向サブ列として残り、数千のロングテールパスは共有スパースストレージに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

**スパースシャーディング。** ロングテールパス数が非常に大きい場合、単一のスパース列が読み取りボトルネックになる可能性があります。スパースシャーディングは、ロングテールパスをハッシュによって複数の物理列（`variant_sparse_hash_shard_count`）に分散させ、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延させ、さらに元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加ストレージのコストで高速インジェストと効率的な全ドキュメント返却を提供します。Subcolumnizationはコンパクション中に後で発生します。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上記に示すように、書き込み時にJSONは高速インジェストのためにDoc Storeにそのまま保存されます。サブ列はコンパクション中に後で抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全な列指向速度で具体化されたサブ列から読み取り、全ドキュメントクエリ（`SELECT v`）はサブ列から再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスが具体化されているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**：クエリされたパスが既にサブ列に抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトVARIANTと同じ完全な列指向速度で読み取り。
- **DOC Map**：クエリされたパスがまだ具体化されていない。クエリは値を見つけるためにdoc map全体のスキャンにフォールバック — 幅広いJSONでは大幅に遅い。
- **DOC Map (Sharded)**：同じフォールバックだが、`variant_doc_hash_shard_count`でdoc mapが複数の物理列に分散され、並列スキャンとはるかに高速な回復を可能にする。

**Storage Format V3。** 列メタデータをセグメントフッターから分離します。特に幅広いJSONの場合、数千のサブ列が存在する際のメタデータボトルネックを排除するため、すべての`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

以下の表を使用して開始点を選択し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパス少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先または全ドキュメント返却） | DOC mode + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみを定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリがいくつかの馴染みのあるパスを繰り返し触れるイベントログや監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化するほど幅広いかどうかまだ確信が持てず、主な価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点：
- パスの増大が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると、利益なしに複雑さが増します。

### Sparseモード

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columnsを選択してください。

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
全体のキー数が非常に大きいが、主要なワークロードがパスベースのフィルタリング、集約、インデックス作成である場合に使用します。

注意点:
- ホットパス分析がボトルネックの場合、最初にDOCモードにジャンプしないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これは既にほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。事実上すべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOCモード](#doc-mode-template)を優先してください。

### DOCモード {#doc-mode-template}

JSON文書全体を返すことや取り込みオーバーヘッドの最小化が、パスベース分析の最適化よりも重要な場合はDOCモードを選択します。

典型的な例：モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合：

- Subcolumnizationスケールが極めて大規模になる場合（10,000パスに近づく場合）、ハードウェア要件が急速に上昇します。DOCモードはこのスケールでより安定した選択肢です。
- コンパクションメモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5～10倍向上できます。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムからの文書再構築を回避し、桁違いの高速化を実現します。

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
ingest スループットが最優先である場合、ワークロードで完全な JSON ドキュメントを頻繁に取得する必要がある場合、または非常に幅の広いカラムを `SELECT variant_col` で頻繁に読み取る場合に使用してください。

注意点：
- DOC モードは、すべての幅の広い JSON ワークロードに対するデフォルトの答えではありません。ホットパス分析が支配的である場合、通常はスパースカラムの方が適しています。
- DOC モードとスパースカラムは相互に排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定したタイプ、安定した動作、またはパス固有のインデックスが必要な場合は、Schema Template を選択してください。

典型的な例：注文、決済、またはデバイスのペイロードで、いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。必要に応じてSchema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSONスキーマ全体を静的テンプレートに変換しないでください。それでは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的なままにしてください。

## パフォーマンス

以下のグラフは、10Kパスのワイドカラムデータセット（20万行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較したものです。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time.svg)

| モード | クエリ時間 | ピークメモリ |
|---|---:|---:|
| DOC Materialized | 76 ms | 1 MiB |
| VARIANT Default | 76 ms | 1 MiB |
| DOC Map (Sharded) | 148 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| DOC Map | 2,533 ms | 1 MiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

重要なポイント：

- **マテリアライズされたサブカラムが優秀。** DefaultとDOC Materializedの両方が約76 msを実現 — 生のSTRINGより80倍高速、JSONBより12倍高速。
- **DOC Mapはシャーディングで改善。** docマップのシャーディングにより、マテリアライズされていないパスのクエリ時間が2.5秒から148 msに短縮。
- **JSONBとSTRINGはメモリを大量消費。** VARIANTモードの1 MiBに対し、32-48 GiBのピークメモリを消費。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルではStorage Format V3から開始。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、ワイドJSONワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが高くなります。
- **Schema Templateで主要パスを早期に固定。** Schema Templateがないと、システムは自動的に型を推測します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格し、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状から調整。** ほとんどのワークロードでは、デフォルトで十分です。AI学習、コネクテッドカー、ユーザータグシステムなどのワークロードで異常に大きなSubcolumnizationスケールと多数のパスレベルインデックスが必要な場合のみ、シナリオ別に調整してください。初日に過度に設定すること（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）は、メリットの証拠なしに複雑さを増すだけです。

### クエリフェーズ

- **非常にワイドな`VARIANT`カラムでは`SELECT *`をメインのクエリパターンとして使用しない。** DOCモードがないと、`SELECT *`や`SELECT variant_col`は全サブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスをCAST。** 型推測は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違う可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視。** サブカラムの増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかをチェックしてください。
- **スキーマドリフトを監視。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージに押し込まれ、クエリの突然の速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにSchema Template経由でそのパスをロックすべきことを示しています。

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
