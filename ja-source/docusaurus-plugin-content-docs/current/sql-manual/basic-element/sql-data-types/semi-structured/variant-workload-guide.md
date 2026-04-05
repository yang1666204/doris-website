---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをどのようにモデル化するかを決める際に使用してください。以下のような質問の答えを導くのに役立ちます：

- このワークロードは`VARIANT`を使うべきか、それとも静的カラムを使うべきか？
- JSONが非常に幅広い場合、デフォルトの動作、sparse columns、またはDOCモードから始めるべきか？
- どの設定をデフォルトのままにしておき、どれを最初に変更すべきか？

`VARIANT`を使いたいことが既に分かっており、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)に進んでください。最小限の実行可能なimport例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)に進んでください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisは頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、ドキュメントスキーマ全体を事前に固定することなく、一般的なフィルタ、集約、パスレベルのインデックスが効率的に動作します。非常に幅広いJSONでは、ストレージレイヤーの最適化により、はるかに多くのパス数でもSubcolumnizationを実用的に保てます。
:::

## VARIANTが適している場合

`VARIANT`は通常、以下の大部分が当てはまる場合に適しています：

- 入力がJSONまたは時間の経過とともにフィールドが変化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- カラム型分析パフォーマンスを諦めることなく、スキーマの柔軟性が欲しい。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が主な場合は、静的カラムを選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパスによる分析ではなく、生のJSONをアーカイブすることである。

## 最初の4つの質問

設定に触れる前に、これらの4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、Dorisはそれらのパスに対してSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も役立つところです。

### 2. いくつかのパスに固定された型や安定したインデックスが必要ですか？

はいの場合は、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールドのためのものであり、ドキュメント全体を記述するためのものではありません。

### 3. これは本当に幅広いJSONになっていますか？

パス数が増え続け、メタデータの負荷、コンパクションの負荷、または顕著なクエリオーバーヘッドが発生し始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、ホットパス分析と全ドキュメント返却のどちらが重要ですか？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集約、インデックス作成である場合は、sparse columnsに傾きます。
- 主な価値がインジェスト効率または全ドキュメントの返却である場合は、DOCモードに傾きます。

## 主要概念

以下のストレージモードを読む前に、これらの用語を明確にしてください。それぞれが2-3行で説明されており、実装の詳細については[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** `VARIANT`カラムにデータが書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`カラムでの宣言。型付け、インデックス化、予測可能性を保つ必要がある主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパス数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストが増加し始めた場合、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールドの分割がある場合、sparse columnsはホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有のsparseストレージにプッシュします。Sparseストレージは、より良い読み取り並列性のために複数の物理カラムにわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして残り、数千のロングテールパスは共有のsparseストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のsparseカラムが読み取りボトルネックになることがあります。Sparse shardingは、ロングテールパスを複数の物理カラム（`variant_sparse_hash_shard_count`）にハッシュで分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時のSubcolumnizationを遅延し、さらに元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加ストレージのコストで高速インジェストと効率的な全ドキュメント返却を実現します。Subcolumnizationはコンパクション中に後で行われます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み時にJSONは高速インジェストのためにDoc Storeにそのまま保存されます。サブカラムはコンパクション中に後で抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全なカラム速度でマテリアライズされたサブカラムから読み取り、全ドキュメントクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスがマテリアライズされているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスが既にサブカラムに抽出されています（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトの`VARIANT`と同じ完全なカラム速度で読み取ります。
- **DOC Map**: クエリされたパスがまだマテリアライズされていません。クエリは値を見つけるためにdoc map全体のスキャンにフォールバックします - 幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**: 同じフォールバックですが、`variant_doc_hash_shard_count`でdoc mapが複数の物理カラムに分散され、並列スキャンとはるかに高速な復旧を可能にします。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。特に幅広いJSONの場合、数千のサブカラムが存在する際のメタデータボトルネックを排除するため、すべての`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | デフォルトVARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広く、ホットパスが少ない） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先または全ドキュメント返却） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（主要パスに安定した型が必要） | Schema Template + AまたはB | 主要パスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型例：イベントログまたは監査ペイロードで、クエリが少数の馴染みのあるパスに繰り返しアクセスする場合。

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
ワークロードがsparse columnsやDOCモードを正当化するのに十分な幅があるかどうかまだ確信が持てず、主な価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用します。

注意点:
- パスの増加がすでに負荷を引き起こしている場合を除き、早期に`variant_max_subcolumns_count`を上げないでください。
- JSONが幅広でない場合、sparse columnsやDOCモードを有効にすると利益なしに複雑性が追加されます。

### Sparse Mode

ペイロードが幅広だが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columnsを選択します。

典型的な例: 数千のオプション属性を持つが、定期的にクエリされるのは数十のみである広告、テレメトリ、またはプロファイルJSON。

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
- ホットパス分析がボトルネックの場合、最初にDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これは既にほとんどのワークロードで自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を優先してください。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや取り込みオーバーヘッドの最小化が、パスベース分析の最適化よりも重要な場合にDOCモードを選択します。

典型的な例: モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが役立つ場合:

- Subcolumnizationスケールが極めて大規模になる場合（10,000パスに近づく場合）、ハードウェア要件が急速に増加します。DOCモードはこのスケールでより安定した選択肢です。
- コンパクションメモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5～10倍向上する可能性があります。
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
ingest throughputが最優先事項の場合、ワークロードで完全なJSONドキュメントを頻繁に取得する必要がある場合、または非常に幅の広いカラムを`SELECT variant_col`で頻繁に読み取る場合に使用してください。

注意点：
- DOCモードは、すべての幅広JSON ワークロードに対するデフォルトの解答ではありません。ホットパス分析が支配的な場合、通常はsparse columnsの方が適しています。
- DOCモードとsparse columnsは相互排他的です。これらを同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合はSchema Templateを選択してください。

典型的な例：order、payment、またはdevice payloadsで、ビジネスクリティカルな少数のパスが型付けされ検索可能な状態を維持する必要がある場合。

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
少数のフィールドのみがビジネスクリティカルで、それらのパスにより厳密な型指定やパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合はSchema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意点:
- JSON スキーマ全体を静的テンプレートに変換しないでください。これは`VARIANT`の意味を損ないます。
- Schema Template は重要なパスのみをカバーし、残りは動的なままにしておくべきです。

## パフォーマンス

以下のチャートは、10K パスの幅広カラムデータセット（200K 行、1つのキーを抽出、16 CPU、3回実行の中央値）における単一パス抽出時間を比較したものです。

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

重要なポイント:

- **Materialized subcolumns が優勝。** Default と DOC Materialized の両方が約 76 ms を実現 — 生の STRING より 80 倍高速、JSONB より 12 倍高速。
- **DOC Map とシャーディングが有効。** doc map をシャーディングすることで、materialized されていないパスのクエリ時間が 2.5 秒から 148 ms に短縮されます。
- **JSONB と STRING はメモリを大量消費。** VARIANT モードの 1 MiB に対して、32-48 GiB のピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルには Storage Format V3 から始める。** V3 はカラムメタデータをセグメントフッターから分離します。これがないと、幅広 JSON ワークロードでファイル開放の遅延と高いメモリオーバーヘッドが発生します。
- **Schema Template で重要なパスを早期に固定する。** Schema Template がないと、システムが自動的に型を推論します。同じパスがバッチ間で型を変更した場合（例：整数から文字列）、JSONB に昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状に応じて調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI トレーニング、コネクテッドビークル、ユーザータグシステムなど、異常に大規模な Subcolumnization スケールと多数のパスレベルインデックスを必要とするワークロードの場合にのみ、シナリオに応じて調整してください。初日から過度に設定すること（非常に大きな`variant_max_subcolumns_count`、不要な場合の DOC モード有効化）は、利益の証拠がないまま複雑さを追加します。

### クエリフェーズ

- **非常に幅広い`VARIANT`カラムのメインクエリパターンとして`SELECT *`を使用しない。** DOC モードなしでは、`SELECT *`または`SELECT variant_col`はすべての subcolumn から大きな JSON を再構築する必要があり、`SELECT v['path']`のようにパスを指定するよりもはるかに遅くなります。
- **クエリが型に依存する場合は、常に subpath を CAST する。** 型推論が期待と一致しない場合があります。`v['id']`が実際には STRING として保存されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **compaction 圧力を監視する。** Subcolumn の増大により、マージコストが増加します。Compaction Score が上昇し続ける場合は、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎないかを確認してください。
- **スキーマドリフトを監視する。** JSON 構造が頻繁に変更されると、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下が発生する可能性があります。Schema Template で重要なパスをロックしてください。
- **型の競合を監視する。** 同じパスでの頻繁な型競合は、JSONB 昇格とインデックス損失を避けるために Schema Template でそのパスをロックすべきであることを示しています。

## クイック検証

テーブル作成後、すべてが動作することを確認するには、この最小限のシーケンスを使用してください：

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
