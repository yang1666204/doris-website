---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスでSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に使用します。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`と静的カラムのどちらを使用すべきか？
- JSONが非常に幅広い場合、デフォルト動作、sparse columns、またはDOCモードのどれから始めるべきか？
- どの設定をデフォルトのままにし、どれを最初に変更すべきか？

すでに`VARIANT`を使いたいことが分かっていて、構文や型のルールだけが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONを柔軟に保ちながら、Dorisは頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、文書スキーマ全体を事前に固定することなく、一般的なフィルタ、集計、パスレベルインデックスが適切に動作します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに多くのパス数でSubcolumnizationを実用的に保つことができます。
:::

## VARIANTが適合する場合

`VARIANT`は通常、以下の条件の大部分が当てはまる場合に適しています：

- 入力がJSONまたはフィールドが時間とともに変化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- カラム分析パフォーマンスを犠牲にすることなく、スキーマの柔軟性が欲しい。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が支配的な場合は、静的カラムを優先してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別分析ではなく、生JSONのアーカイブである。

## まず4つの質問

設定に触れる前に、これら4つの質問に答えてください。

### 1. 明確なホットパスがありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、DorisはそれらのパスにSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も役立つ場面です。

### 2. 一部のパスに固定型または安定したインデックスが必要ですか？

必要な場合は、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールド用であり、文書全体を記述するためのものではありません。

### 3. これは本当に幅広いJSONになっていますか？

パス数が増え続け、メタデータの負荷、コンパクションの負荷、または顕著なクエリオーバーヘッドを生み出し始めた時に、幅広いJSONの問題があります。

### 4. 幅広いJSONでは、ホットパス分析と文書全体の返却のどちらがより重要ですか？

- 主な価値がまだホットフィールドでのパスベースのフィルタリング、集計、インデックスである場合は、sparse columnsに向かう。
- 主な価値がインジェスト効率または文書全体の返却である場合は、DOCモードに向かう。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれる際、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`カラムの宣言。型付け、インデックス化、予測可能性を維持する必要がある主要なビジネスフィールドに使用します。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始した時に、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールドの分割がある場合、sparse columnsはホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。スパースストレージは、より良い読み取り並列性のために複数の物理カラムにわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして残り、数千のロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のスパースカラムが読み取りボトルネックになる可能性があります。Sparse shardingは、ロングテールパスをハッシュで複数の物理カラム（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延させ、追加で元のJSONをマップ形式のストアドフィールド（**doc map**）として保存します。これにより、追加ストレージのコストで高速インジェストと効率的な文書全体の返却を提供します。Subcolumnizationはコンパクション中に後で発生します。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み時にJSONは高速インジェストのためにDoc Storeにそのまま保存されます。サブカラムはコンパクション中に後で抽出されます。読み取り時には、パスベースクエリ（例：`SELECT v['user_id']`）は完全なカラム速度でマテリアライズされたサブカラムから読み取り、文書全体クエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスがマテリアライズされているかどうかによって3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスがすでにサブカラムに抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルトのVARIANTと同じ、完全なカラム速度で読み取り。
- **DOC Map**: クエリされたパスがまだマテリアライズされていない。クエリは値を見つけるために文書マップ全体をスキャンするフォールバックを行う — 幅広いJSONでは大幅に遅くなる。
- **DOC Map (Sharded)**: 同じフォールバックだが、`variant_doc_hash_shard_count`でdoc mapが複数の物理カラムに分散され、並列スキャンとはるかに高速な復旧を可能にする。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。任意の`VARIANT`テーブル、特に幅広いJSONに推奨されます。数千のサブカラムが存在する際のメタデータボトルネックを排除するからです。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを保持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパス少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先または文書全体返却） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型例：クエリが少数の馴染みのあるパスに繰り返しアクセスするイベントログや監査ペイロード。

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
以下の場合に使用してください：ワークロードがsparse columnsやDOCモードを正当化するのに十分な幅があるかまだ確信がなく、大部分の価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合。

注意点：
- パスの増加が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると利益なしに複雑さが増します。

### Sparseモード

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columnsを選択してください。

典型的な例：広告、テレメトリ、または数千のオプション属性を持つが定期的にクエリされるのは数十のみのプロファイルJSON。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、およびインデックス作成である場合に使用します。

注意点:
- ホットパス分析がボトルネックの場合は、最初にDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。すべてのパスが事実上Subcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大きな抽出サブカラムスケールを必要とする場合は、[DOCモード](#doc-mode-template)を推奨します。

### DOCモード {#doc-mode-template}

JSON文書全体を返すことや、パスベース分析の最適化よりも取り込みオーバーヘッドの最小化が重要な場合は、DOCモードを選択してください。

典型例: モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合:

- Subcolumnizationスケールが極めて大きくなる場合（10,000パスに近づく）、ハードウェア要件は急速に上昇します。このスケールではDOCモードがより安定した選択肢です。
- コンパクション メモリは、デフォルトの積極的なSubcolumnizationと比較して約3分の2削減できます。
- 疎なワイドカラムの取り込みワークロードにおいて、スループットを約5-10倍改善できます。
- クエリが`VARIANT`値全体（`SELECT variant_col`）を読み取る場合、DOCモードは数千のサブカラムからの文書再構築を回避し、桁違いの高速化を実現します。

**開始方法:**

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
ingest throughputが最優先の場合、ワークロードで完全なJSONドキュメントを頻繁に戻す必要がある場合、または非常に幅の広いカラムを`SELECT variant_col`で頻繁に読み取る場合に使用します。

注意点：
- DOCモードは、すべての幅の広いJSONワークロードに対するデフォルトの答えではありません。ホットパス分析が主要な場合、通常はsparse columnsの方が適しています。
- DOCモードとsparse columnsは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択します。

典型的な例：いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある注文、支払い、またはデバイスのペイロード。

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
ビジネスクリティカルなフィールドが少数のみで、それらのパスによりstrict typing やパスレベルのインデックス戦略が必要な場合に使用します。適切な場合はSchema Templateをsparse columnsやdefault `VARIANT`と組み合わせます。

注意点：
- JSON schemaをstatic templateに全て変換しないでください。これは`VARIANT`の利点を台無しにします。
- Schema Templateはキーパスのみをカバーし、残りはdynamicのままにする必要があります。

## パフォーマンス

以下のチャートは、10K-path wide-columnデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

主要なポイント：

- **Materialized subcolumnsが勝利。** DefaultとDOC Materializedの両方が約76 msを実現 — raw STRINGより80倍速く、JSONBより12倍高速です。
- **ShardingによるDOC Mapが効果的。** Doc mapのshardingにより、materialized化されていないパスのクエリ時間が2.5秒から148 msに短縮されます。
- **JSONBとSTRINGはメモリ消費が大きい。** VARIANTモードの1 MiBに対し、32–48 GiBのピークメモリを消費します。

## ベストプラクティス

### Import Phase

- **新しい`VARIANT`テーブルではStorage Format V3から開始する。** V3はカラムメタデータをsegment footerから分離します。これがないと、wide JSON workloadでファイルオープンの遅延と高いメモリオーバーヘッドが発生します。
- **Schema Templateを通じて早期にキーパスを固定する。** Schema Templateがないと、システムは型を自動推測します。同じパスがバッチ間で型が変わると（例：integerからstring）、JSONBにpromoteされ、そのパス上のインデックスが失われます。
- **デフォルト設定から開始し、症状に応じてチューニングする。** ほとんどのworkloadでは、デフォルトで十分です。AI training、connected vehicle、user-tagシステムなど、異常に大きなSubcolumnization scaleと多くのpath-levelインデックスが必要な特別なworkloadの場合のみシナリオ別にチューニングします。初日から過度に設定する（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）と、効果の証拠なしに複雑性が増します。

### Query Phase

- **非常にwideな`VARIANT`カラムのメインクエリパターンとして`SELECT *`を使わない。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`はすべてのsubcolumnから大きなJSONを再構築する必要があり、`SELECT v['path']`のようにパスを指定するより大幅に遅くなります。
- **クエリが型に依存する場合は常にsubpathをCASTする。** 型推測は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているが整数リテラルと比較する場合、インデックスが使用されず、結果が間違う可能性があります。

### Operations Phase

- **compaction pressureを監視する。** subcolumnの増大はmergeコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認します。
- **schema driftを監視する。** JSON構造が頻繁に変わると、hot pathがsparse storageに押しやられ、突然のクエリ遅延を引き起こす可能性があります。Schema Templateで重要なパスを固定します。
- **型競合を監視する。** 同じパス上で頻繁に型競合が発生する場合、JSONBへのpromoteとインデックス損失を避けるためにSchema Template経由でパスを固定する必要があることを示します。

## 簡単な確認

テーブル作成後、すべてが動作することを確認するためにこの最小限のシーケンスを使用します：

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
