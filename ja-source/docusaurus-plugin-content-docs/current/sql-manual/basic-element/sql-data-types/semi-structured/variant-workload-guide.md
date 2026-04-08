---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

新しい`VARIANT`ワークロードのモデル化方法を決定する際は、このガイドを使用してください。以下のような質問への回答に役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが非常に幅広い場合、デフォルトの動作、sparse columns、またはDOCモードから始めるべきか？
- どの設定をデフォルトのままにしておき、どの設定を最初に変更すべきか？

すでに`VARIANT`を使用したいことがわかっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。実行可能な最小のインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選択する理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisは頻繁に使用されるパスに対してSubcolumnizationを適用できます。これにより、ドキュメントスキーマ全体を事前に固定することなく、一般的なフィルタ、集計、パスレベルのインデックスが適切に機能します。非常に幅広いJSONでは、ストレージ層の最適化により、Subcolumnizationをはるかに大規模なパス数で実用的に保つことができます。
:::

## VARIANTが適している場合

以下の条件のほとんどが当てはまる場合、`VARIANT`は通常適しています：

- 入力がJSONまたはその他の半構造化ペイロードで、フィールドが時間の経過とともに発展する。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- 列指向分析パフォーマンスを諦めることなく、スキーマの柔軟性が必要。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が支配的な場合は、静的カラムを選択してください：

- スキーマが安定しており、事前にわかっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別の分析ではなく、生のJSONをアーカイブすることである。

## 最初に答える4つの質問

設定に触れる前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスが存在するか？

クエリが同じJSONパスに繰り返し触れる場合、Dorisはそれらのパスに対してSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も役立つ場面です。

### 2. いくつかのパスに固定の型や安定したインデックスが必要か？

もしそうなら、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールド用であり、ドキュメント全体を記述するためのものではありません。

### 3. 本当に幅広いJSONになっているか？

パス数が増え続け、メタデータの圧迫、コンパクションの圧迫、または顕著なクエリオーバーヘッドを生み出し始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、何がより重要か：ホットパス分析かドキュメント全体の返却か？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集計、インデックスにある場合は、sparse columnsを選択してください。
- 主な価値がインジェスト効率またはドキュメント全体の返却にある場合は、DOCモードを選択してください。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれるとき、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列指向サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`カラムの宣言。型付け、インデックス付け、予測可能性を保つ必要がある主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパス数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を始めたとき、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールドの分離がある場合、sparse columnsはホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有sparseストレージにプッシュします。Sparseストレージは、読み取り並列性を向上させるために複数の物理カラムでのシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page`など）は完全な分析速度で独立した列指向サブカラムとして残り、数千のロングテールパスは共有sparseストレージに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のsparseカラムが読み取りボトルネックになる可能性があります。Sparse shardingは、ハッシュによってロングテールパスを複数の物理カラム（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時のSubcolumnizationを遅延し、さらに元のJSONをマップ形式の格納フィールド（**docマップ**）として格納します。これにより、追加ストレージのコストで高速なインジェストと効率的なドキュメント全体の返却を実現します。Subcolumnizationは後でコンパクション中に行われます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図のように、書き込み時にJSONは高速なインジェストのためにDoc Storeにそのまま保存されます。サブカラムは後でコンパクション中に抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全な列指向速度で実体化されたサブカラムから読み取り、ドキュメント全体のクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスが実体化されているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**：クエリされたパスがすでにサブカラムに抽出されています（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトのVARIANTと同じく、完全な列指向速度で読み取ります。
- **DOC Map**：クエリされたパスがまだ実体化されていません。クエリは値を見つけるためにdocマップ全体をスキャンするフォールバックを行います — 幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**：同じフォールバックですが、`variant_doc_hash_shard_count`でdocマップが複数の物理カラムに分散され、並列スキャンと大幅に高速な復旧を可能にします。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。数千のサブカラムが存在するときにメタデータボトルネックを排除するため、すべての`VARIANT`テーブル、特に幅広いJSONに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

以下の表を使用して開始点を選択し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを保持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広く、ホットパスが少ない） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先またはドキュメント全体の返却） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみを定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリが少数の馴染みのあるパスに繰り返し触れるイベントログや監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化できるほど幅広いかどうかまだ確信が持てず、主な価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点:
- パスの増加が既に負荷を引き起こしている場合を除き、早期に`variant_max_subcolumns_count`を上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると、利益なしに複雑性が増加します。

### Sparse Mode

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columnsを選択してください。

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
総キー数が非常に大きいが、主要なワークロードがパスベースのフィルタリング、集約、インデックス化である場合に使用してください。

注意点:
- ホットパス分析がボトルネックの場合は、最初にDOCモードに飛びつかないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードでの自動Subcolumnizationの適切な開始点です。事実上すべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大きな抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を優先してください。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや取り込みオーバーヘッドの最小化が、パスベース分析の最適化よりも重要な場合はDOCモードを選択してください。

典型的な例: モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合:

- Subcolumnizationスケールが極端に大きくなる場合（10,000パスに近づく）、ハードウェア要件が急速に上昇します。この規模ではDOCモードがより安定した選択です。
- コンパクションメモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースワイドカラム取り込みワークロードでは、スループットが約5～10倍向上する場合があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムからの文書再構築を回避し、桁違いの高速化を実現します。

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
ingest throughputが最優先事項である場合、ワークロードで完全なJSONドキュメントを頻繁に取得する必要がある場合、または`SELECT variant_col`で非常に幅広いカラムを頻繁に読み取る場合に使用してください。

注意点：
- DOCモードは、すべての幅広いJSONワークロードに対するデフォルトの回答ではありません。ホットパス分析が主である場合、通常はsparse columnsの方が適しています。
- DOCモードとsparse columnsは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択してください。

典型的な例：order、payment、またはdeviceペイロードで、いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数のみで、これらのパスでより厳密な型指定やパスレベルインデックス戦略が必要な場合に使用します。適切な場合は、Schema Templateとスパース列またはデフォルトの`VARIANT`を組み合わせます。

注意点：
- JSON スキーマ全体を静的テンプレートに変換しないでください。これでは`VARIANT`の意味がなくなります。
- Schema Templateは重要なパスのみをカバーし、残りは動的のままにします。

## パフォーマンス

以下のチャートは、10K パスのワイドカラムデータセット（20万行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

重要なポイント：

- **マテリアライズされたサブカラムが最良。** DefaultとDOC Materializedの両方で約76msを実現 — 生のSTRINGより80倍高速、JSOTBより12倍高速です。
- **DOC MapにおけるシャーディングはPBに役立つ。** docマップのシャーディングにより、マテリアライズされていないパスのクエリ時間が2.5秒から148msに短縮されます。
- **JSOTBとSTRINGはメモリ集約的。** VARIANTモードの1MiBに対し、32〜48GiBのピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルではStorage Format V3から開始。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、ワイドJSONワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが高くなります。
- **Schema Templateで重要なパスを早期に固定。** Schema Templateがないと、システムは自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSOTBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整。** ほとんどのワークロードでは、デフォルトで十分です。AI訓練、コネクテッドビークル、ユーザータグシステムなど、異常に大規模なSubcolumnizationスケールと多数のパスレベルインデックスが必要なワークロードでのみ、シナリオ別に調整してください。初日からの過剰設定（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）は、利益の根拠なしに複雑さを追加します。

### クエリフェーズ

- **非常にワイドな`VARIANT`カラムに対してメインクエリパターンとして`SELECT *`を使用しない。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパスの指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は常にサブパスをCAST。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているが整数リテラルと比較する場合、インデックスは使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視。** サブカラムの増加によりマージコストが増加します。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateでクリティカルパスをロックしてください。
- **型競合を監視。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるため、そのパスをSchema Templateでロックすべきことを示しています。

## クイック検証

テーブル作成後、すべてが動作することを確認するため、この最小限のシーケンスを使用してください：

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
