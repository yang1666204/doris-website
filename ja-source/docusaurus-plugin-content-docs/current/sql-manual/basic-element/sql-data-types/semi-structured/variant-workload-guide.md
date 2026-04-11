---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを適用します。

新しい`VARIANT`ワークロードをモデル化する方法を決定する際は、このガイドを使用してください。以下のような質問に答える際に役立ちます：

- このワークロードで`VARIANT`を使用すべきか、それとも静的列を使用すべきか？
- JSONが非常に幅広い場合、デフォルトの動作、sparse columns、DOC modeのうちどれから始めるべきか？
- どの設定をデフォルトのままにし、どの設定を最初に変更すべきか？

すでに`VARIANT`を使用することが決まっており、構文や型のルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisが頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、文書スキーマ全体を事前に固定することなく、一般的なフィルタ、集約、パスレベルのインデックスが適切に機能します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに多くのパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

以下の条件の大部分が当てはまる場合、通常`VARIANT`が適しています：

- 入力がJSONまたは時間の経過とともにフィールドが変化する他の半構造化ペイロードである
- クエリが通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる
- カラムナー分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままで良い

以下の条件が主な場合は、静的列を選択してください：

- スキーマが安定しており、事前に分かっている
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される
- 主な要件がパス別の分析ではなく、生JSONのアーカイブである

## 最初の4つの質問

設定を変更する前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスがありますか？

クエリが同じJSONパスに繰り返し触れる場合、Dorisはそれらのパスに対してSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も役立つ場面です。

### 2. 少数のパスで固定型や安定したインデックスが必要ですか？

必要な場合は、それらのパスのみにSchema Templateを使用してください。これは文書全体を記述するためではなく、少数のビジネスクリティカルなフィールドのために設計されています。

### 3. 本当に幅広いJSONになっていますか？

パス数が増加し続け、メタデータの圧迫、コンパクションの圧迫、または顕著なクエリオーバーヘッドを発生させ始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、何がより重要ですか：ホットパス分析か文書全体の返却か？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集約、インデックスである場合は、sparse columnsを選択してください
- 主な価値が取り込み効率または文書全体の返却である場合は、DOC modeを選択してください

## 主要な概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`列に書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラムナーサブ列として抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`列の宣言。型付け、インデックス化、予測可能性を維持する必要がある主要なビジネスフィールドに使用します。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 個別パスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始した場合、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールドの分離がある場合、sparse columnsはホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有sparse storageにプッシュします。Sparse storageは、より良い読み取り並列性のために複数の物理列にわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラムナーサブ列として維持され、数千のロングテールパスは共有sparse storageに集約されます。閾値は`variant_max_subcolumns_count`で制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のsparse columnが読み取りボトルネックになる可能性があります。Sparse shardingは、ロングテールパスをハッシュにより複数の物理列（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOC mode。** 書き込み時にSubcolumnizationを遅延し、さらに元のJSONをmapフォーマットの格納フィールド（**doc map**）として保存します。これにより、追加ストレージのコストで高速な取り込みと効率的な文書全体の返却が可能になります。Subcolumnizationはコンパクション中に後で行われます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図のように、書き込み中にJSONは高速取り込みのためにDoc Storeにそのまま保存されます。サブ列はコンパクション中に後で抽出されます。読み取り時には、パスベースのクエリ（例：`SELECT v['user_id']`）は完全なカラムナー速度でマテリアライズされたサブ列から読み取り、文書全体のクエリ（`SELECT v`）はサブ列から再構築することなく、Doc Storeから直接読み取ります。

DOC modeには、クエリされるパスがマテリアライズされているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**：クエリされるパスがすでにサブ列に抽出されています（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルト`VARIANT`と同じ完全なカラムナー速度で読み取ります。
- **DOC Map**：クエリされるパスがまだマテリアライズされていません。クエリは値を見つけるためにdoc map全体をスキャンするフォールバックを行います — 幅広いJSONでは大幅に低速です。
- **DOC Map (Sharded)**：同じフォールバックですが、`variant_doc_hash_shard_count`でdoc mapが複数の物理列に分散され、並列スキャンとはるかに高速な復旧が可能になります。

**Storage Format V3。** 列メタデータをセグメントフッターから切り離します。任意の`VARIANT`テーブル、特に幅広いJSONに推奨されます。数千のサブ列が存在する場合のメタデータボトルネックが解消されるためです。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選択するために以下のテーブルを使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告 / テレメトリ / ユーザープロファイル（幅広く、ホットパスは少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力 / トレース / アーカイブ（取り込み優先または文書全体の返却） | DOC mode + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文 / 支払い / デバイス（主要パスに安定した型が必要） | Schema Template + A または B | 主要パスのみ定義 |

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
ワークロードがsparse columnsやDOCモードを正当化するほど十分に幅広いかどうかまだ確信が持てず、フィルタリング、集約、および複数の共通パスでのグループ化からほとんどの価値が得られる場合に使用します。

注意点:
- パスの増大が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると利益なしに複雑性が増します。

### Sparse Mode

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columnsを選択してください。

典型的な例: 数千のオプション属性を持つが、定期的にクエリされるのは数十個のみである広告、テレメトリ、またはプロファイルJSONです。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、およびインデックス化である場合に使用します。

注意点：
- ホットパス分析がボトルネックの場合、まずDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これは既にほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通過するほど大きく設定しないでください。ワークロードが本当に非常に大きな抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を推奨します。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや、パスベースの分析を最適化するよりも取り込みオーバーヘッドを最小化することが重要な場合は、DOCモードを選択します。

典型的な例：モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードは以下の場合に有効です：

- Subcolumnizationスケールが極めて大きくなる場合（10,000パスに近づく場合）、ハードウェア要件が急速に上昇します。この規模では、DOCモードがより安定した選択肢です。
- コンパクションメモリは、デフォルトの積極的なSubcolumnizationと比較して約3分の2削減できます。
- スパースワイドカラムの取り込みワークロードでは、スループットが約5〜10倍向上する可能性があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは何千ものサブカラムから文書を再構築することを回避し、桁違いの高速化を実現します。

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
ingest throughputが最優先の場合、ワークロードが完全なJSONドキュメントを頻繁に必要とする場合、または非常に幅広いカラムが`SELECT variant_col`で頻繁に読み取られる場合に使用します。

注意点:
- DOCモードは、すべての幅広いJSONワークロードに対するデフォルトの解決策ではありません。ホットパス分析が主要な場合、通常はsparse columnsの方が適しています。
- DOCモードとsparse columnsは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択します。

典型的な例: 注文、決済、またはデバイスのペイロードで、いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスがより厳密な型付けやパスレベルのインデックス戦略を必要とする場合に使用してください。適切な場合は、Schema TemplateをスパースカラムやデフォルトのVARIANTと組み合わせます。

注意点：
- JSON スキーマ全体を静的テンプレートに変換しないでください。これはVARIANTの目的を無効にします。
- Schema Templateは重要なパスのみをカバーし、残りは動的のままにしておく必要があります。

## Performance

以下のチャートは、10K パス幅の wide-column データセット（200K 行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較したものです。

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

- **マテリアライズされたサブカラムが勝利。** Default と DOC Materialized の両方が約 76 ms を実現 — 生の STRING より 80 倍高速、JSONB より 12 倍高速。
- **DOC Map とシャーディングが効果的。** doc map をシャーディングすることで、マテリアライズされていないパスのクエリ時間が 2.5 秒から 148 ms に短縮されます。
- **JSONB と STRING はメモリ消費が大きい。** VARIANT モードの 1 MiB に対して、32–48 GiB のピークメモリを消費します。

## Best Practices

### Import Phase

- **新しいVARIANTテーブルには Storage Format V3 から始める。** V3 はカラムメタデータをセグメントフッターから分離します。これがないと、幅広い JSON ワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが高くなります。
- **Schema Template を使用して重要なパスを早期に固定する。** Schema Template がないと、システムは型を自動的に推論します。同じパスが複数のバッチ間で型を変更する場合（例：整数から文字列）、JSONB に昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状に基づいて調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI トレーニング、コネクテッドビークル、ユーザータグシステムなどのワークロードが異常に大規模な Subcolumnization スケールと多くのパスレベルインデックスを必要とする場合にのみ、シナリオ別に調整してください。初日の過度な設定（非常に大きなvariant_max_subcolumns_count、不要な場合の DOC モード有効化）は、利益の証拠なしに複雑性を追加します。

### Query Phase

- **非常に幅広いVARIANTカラムの主要クエリパターンとしてSELECT *を使用しない。** DOC モードがない場合、SELECT *やSELECT variant_colはすべてのサブカラムから大きな JSON を再構築する必要があり、SELECT v['path']のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスをCASTする。** 型推論は期待と一致しない場合があります。v['id']が実際に STRING として格納されているが、整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### Operations Phase

- **コンパクション圧力を監視する。** サブカラムの成長によりマージコストが増加します。Compaction Score が上昇し続ける場合は、variant_max_subcolumns_countが高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視する。** JSON 構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Template で重要なパスをロックしてください。
- **型の競合を監視する。** 同じパスでの頻繁な型競合は、JSONB 昇格とインデックス損失を避けるために Schema Template でそのパスをロックすべきであることを示しています。

## Quick Verify

テーブル作成後、すべてが動作することを確認するために、この最小限のシーケンスを使用してください：

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
