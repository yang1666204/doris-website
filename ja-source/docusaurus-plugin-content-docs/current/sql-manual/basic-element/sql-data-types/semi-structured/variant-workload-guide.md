---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、ならびに設定の開始点に関する判断ガイド。"
}
---
## 概要

`VARIANT`は半構造化されたJSONを格納し、よく使われるパスにSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に使用します。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使うべきか、静的列を使うべきか？
- JSONが非常に幅広い場合、デフォルト動作、スパース列、DOCモードのどれから始めるべきか？
- どの設定をデフォルトのままにして、どれを最初に変更すべきか？

すでに`VARIANT`を使いたいことが分かっていて、構文や型ルールだけが必要な場合は、[VARIANT](./VARIANT)に進んでください。最小の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)に進んでください。

:::tip なぜVARIANTを選ぶのか
`VARIANT`はJSONの柔軟性を保ちつつ、Dorisがよく使われるパスにSubcolumnizationを適用できます。これにより、一般的なフィルタ、集約、パスレベルのインデックスが、ドキュメントスキーマ全体を事前に固定することなく効果的に機能します。非常に幅広いJSONでは、ストレージレイヤーの最適化により、はるかに多いパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

`VARIANT`は通常、以下のほとんどが当てはまる場合に適しています：

- 入力がJSONまたは時間の経過とともにフィールドが変化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- 列型分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的のままでよい。

以下の条件が優勢な場合は静的列を選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される。
- 主要な要件がパスによる分析ではなく、生のJSONのアーカイブである。

## 最初の4つの質問

設定を触る前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスがありますか？

クエリが繰り返し同じJSONパスにアクセスする場合、Dorisはそれらのパスに継続的にSubcolumnizationを適用できます。これが`VARIANT`が最も役立つ場面です。

### 2. 少数のパスに固定型や安定したインデックスが必要ですか？

必要な場合は、それらのパスにのみSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールド用であり、ドキュメント全体を記述するためのものではありません。

### 3. これは本当に幅広いJSONになっていますか？

パス数が増加し続け、メタデータの圧迫、コンパクションの圧迫、または目立つクエリオーバーヘッドを引き起こし始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、ホットパス分析とドキュメント全体の返却のどちらがより重要ですか？

- 主な価値がホットフィールドでのパスベースフィルタリング、集約、インデックス作成の場合は、スパース列を選択してください。
- 主な価値がインジェスト効率またはドキュメント全体の返却の場合は、DOCモードを選択してください。

## 重要な概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`列に書き込まれるとき、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列型サブ列として抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`列での宣言。型付け、インデックス作成、予測可能性が必要な主要なビジネスフィールドに使用します。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストを増加させ始めた場合、幅広いJSONの問題があります。

**スパース列。** 幅広いJSONに明確なホット/コールドの分離がある場合、スパース列はホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有スパースストレージに押し込みます。スパースストレージは、より良い読み取り並列性のために複数の物理列にわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立した列型サブ列として維持され、数千のロングテールパスは共有スパースストレージに集約されます。閾値は`variant_max_subcolumns_count`で制御されます。

**スパースシャーディング。** ロングテールパス数が非常に大きい場合、単一のスパース列が読み取りボトルネックになる可能性があります。スパースシャーディングは、ロングテールパスをハッシュによって複数の物理列（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延させ、さらに元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加ストレージのコストでも高速なインジェストと効率的なドキュメント全体の返却を実現します。Subcolumnizationはコンパクション中に後で実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図のように、書き込み中はJSONが高速インジェストのためにそのままDoc Storeに保存されます。サブ列は後でコンパクション中に抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全な列型速度で物質化されたサブ列から読み取り、ドキュメント全体のクエリ（`SELECT v`）はサブ列から再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスが物質化されているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスがすでにサブ列に抽出されています（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルトのVARIANTと同じ完全な列型速度で読み取ります。
- **DOC Map**: クエリされたパスがまだ物質化されていません。クエリは値を見つけるためにdoc map全体をスキャンすることにフォールバックします — 幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**: 同じフォールバックですが、`variant_doc_hash_shard_count`によりdoc mapが複数の物理列に分散され、並列スキャンとはるかに高速な復旧が可能になります。

**Storage Format V3。** 列メタデータをセグメントフッターから切り離します。数千のサブ列が存在する場合のメタデータボトルネックを排除するため、すべての`VARIANT`テーブル、特に幅広いJSONに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパス少ない） | Sparse + V3 | `variant_max_subcolumns_count`, `variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先またはドキュメント全体返却） | DOC mode + V3 | `variant_enable_doc_mode`, `variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（主要パスに安定した型が必要） | Schema Template + A または B | 主要パスのみ定義 |

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
    "replication_num" = "1",
    "storage_format" = "V3"
);
```
ワークロードがsparse columnsやDOCモードを正当化するのに十分な幅があるかどうかまだ確実でなく、価値の大部分がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点：
- パスの増加がすでに圧迫を引き起こしている場合を除き、早期に`variant_max_subcolumns_count`を上げないでください。
- JSONが広くない場合、sparse columnsやDOCモードを有効にすると、利益なしに複雑性が追加されます。

### Sparseモード

ペイロードが広いが、ほとんどのクエリが少数のホットパスに焦点を当てている場合は、sparse columnsを選択してください。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、インデックス作成である場合に使用します。

注意点：
- ホットパス分析がボトルネックの場合は、最初にDOCモードに飛びつかないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードでの自動Subcolumnizationにとって適切な開始点です。事実上すべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが真に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を推奨します。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや、パスベース分析の最適化よりも取り込みオーバーヘッドを最小化することが重要な場合は、DOCモードを選択してください。

典型的な例：モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合：

- Subcolumnizationのスケールが極めて大きくなる場合（10,000パスに近づく場合）、ハードウェア要件は急速に上昇します。この規模では、DOCモードがより安定した選択です。
- コンパクションメモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5～10倍向上する可能性があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムから文書を再構築することを回避し、桁違いの高速化を実現します。

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
ingest throughputが最優先事項である場合、ワークロードで完全なJSONドキュメントを頻繁に取得する必要がある場合、または`SELECT variant_col`で非常に幅の広いカラムを頻繁に読み取る場合に使用します。

注意点：
- DOCモードは、すべての幅の広いJSONワークロードに対するデフォルトの答えではありません。ホットパス分析が支配的な場合、sparse columnsの方が通常適しています。
- DOCモードとsparse columnsは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のpathで安定した型、安定した動作、またはpath固有のindexが必要な場合にSchema Templateを選択します。

典型例：order、payment、またはdevice payloadで、いくつかのビジネスクリティカルなpathが型付けされ、検索可能な状態を維持する必要がある場合。

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
少数のフィールドのみがビジネス上重要で、それらのパスにより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合は、Schema TemplateをSparseカラムやデフォルトの`VARIANT`と組み合わせます。

注意点：
- JSON スキーマ全体を静的テンプレートに変換しないでください。これでは `VARIANT` の意味がありません。
- Schema Template は主要なパスのみをカバーし、残りは動的なままにしておく必要があります。

## パフォーマンス

以下のグラフは、10K パス幅の列データセット（200K 行、1 つのキーを抽出、16 CPU、3 回実行の中央値）での単一パス抽出時間を比較したものです。

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

- **マテリアライズ化されたサブカラムが勝利。** Default と DOC Materialized の両方が約 76 ms を実現 — 生の STRING より 80 倍高速、JSONB より 12 倍高速。
- **シャーディングされた DOC Map が効果的。** ドキュメントマップをシャーディングすることで、マテリアライズ化されていないパスのクエリ時間を 2.5 秒から 148 ms に短縮。
- **JSONB と STRING はメモリを大量消費。** VARIANT モードの 1 MiB に対し、32–48 GiB のピークメモリを消費。

## ベストプラクティス

### インポートフェーズ

- **新しい `VARIANT` テーブルには Storage Format V3 から開始してください。** V3 はカラムメタデータをセグメントフッターから分離します。これがないと、幅の広い JSON ワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが高くなります。
- **Schema Template を通じて主要パスを早期に固定してください。** Schema Template がないと、システムは自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONB に昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状に応じて調整してください。** ほとんどのワークロードでは、デフォルトで十分です。AI トレーニング、コネクテッドカー、ユーザータグシステムなどのワークロードで異常に大きな Subcolumnization スケールと多数のパスレベルインデックスが必要な場合のみ、シナリオごとに調整してください。初日から過度に設定すること（非常に大きな `variant_max_subcolumns_count`、不要な場合の DOC モード有効化）は、利益の証拠なしに複雑さを追加します。

### クエリフェーズ

- **非常に幅の広い `VARIANT` カラムに対して `SELECT *` を主要なクエリパターンとして使用しないでください。** DOC モードがない場合、`SELECT *` や `SELECT variant_col` はすべてのサブカラムから大きな JSON を再構築する必要があり、`SELECT v['path']` のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスを CAST してください。** 型推論は期待と一致しない場合があります。`v['id']` が実際には STRING として格納されているが整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション負荷を監視してください。** サブカラムの成長はマージコストを増加させます。Compaction Score が上昇し続ける場合は、`variant_max_subcolumns_count` が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視してください。** JSON 構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Template で重要なパスを固定してください。
- **型競合を監視してください。** 同じパスでの頻繁な型競合は、JSONB 昇格とインデックス損失を避けるために Schema Template を通じてパスを固定する必要があることを示しています。

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
