---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、設定を開始する場所についての決定ガイド。"
}
---
## 概要

`VARIANT`はセミ構造化JSONを格納し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをモデル化する方法を決定する際に使用してください。以下のような疑問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使うべきか、それとも静的列を使うべきか？
- JSONが非常に幅広い場合、デフォルトの動作、スパース列、DOCモードのどれから始めるべきか？
- どの設定をデフォルトのままにして、どれを最初に変更すべきか？

既に`VARIANT`を使いたいことが分かっていて、構文や型のルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONを柔軟に保ちながら、Dorisは頻繁に使用されるパスに対してSubcolumnizationを適用することができます。これにより、ドキュメントスキーマ全体を事前に固定することなく、一般的なフィルター、集約、パスレベルのインデックスが適切に機能します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに大きなパス数でもSubcolumnizationを実用的に保ちます。
:::

## VARIANTが適している場合

以下の条件のほとんどが当てはまる場合、`VARIANT`は通常適しています：

- 入力がJSONまたは時間の経過とともにフィールドが進化する他のセミ構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットのみに触れる。
- 列指向分析パフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が支配的な場合は静的列を優先してください：

- スキーマが安定しており、事前に判明している。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される。
- 主な要件がパスによる分析ではなく、生のJSONのアーカイブである。

## 最初の4つの質問

設定に触れる前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスに繰り返し触れる場合、Dorisはそれらのパスに対してSubcolumnizationを継続して適用できます。これが`VARIANT`が最も役立つところです。

### 2. いくつかのパスで固定型や安定したインデックスが必要ですか？

はいの場合、それらのパスのみにSchema Templateを使用してください。これは少数のビジネス上重要なフィールド用であり、ドキュメント全体を記述するためのものではありません。

### 3. 本当に幅広いJSONになっていますか？

パス数が増え続け、メタデータの圧迫、コンパクション圧迫、または顕著なクエリオーバーヘッドを作り始めた時、幅広いJSONの問題があります。

### 4. 幅広いJSONにおいて、ホットパス分析と全ドキュメント返却のどちらがより重要ですか？

- 主な価値がホットフィールドでのパスベースフィルタリング、集約、インデックスである場合は、スパース列に寄せてください。
- 主な価値が取り込み効率や全ドキュメントの返却である場合は、DOCモードに寄せてください。

## キー概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています；実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`列に書き込まれる際、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列指向サブ列として抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`列での宣言。型付けされ、インデックス可能で、予測可能でなければならないキービジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパス数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストを増加させ始めた時、幅広いJSONの問題があります。

**スパース列。** 幅広いJSONに明確なホット/コールド分離がある場合、スパース列はホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。スパースストレージは、より良い読み取り並列性のために複数の物理列にわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上記のように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立した列指向サブ列として残り、数千のロングテールパスは共有スパースストレージに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

**スパースシャーディング。** ロングテールパス数が非常に大きい場合、単一のスパース列が読み取りボトルネックになる可能性があります。スパースシャーディングは、複数の物理列（`variant_sparse_hash_shard_count`）にわたってハッシュによりロングテールパスを分散させ、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延させ、さらに元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加ストレージのコストで高速取り込みと効率的な全ドキュメント返却を提供します。Subcolumnizationは後でコンパクション中に行われます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上記のように、書き込み時にJSONは高速取り込みのためにDoc Storeにそのまま保存されます。サブ列は後でコンパクション中に抽出されます。読み取り時、パスベースクエリ（例：`SELECT v['user_id']`）は完全な列指向速度でマテリアライズされたサブ列から読み取り、全ドキュメントクエリ（`SELECT v`）はサブ列から再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスがマテリアライズされているかどうかによって3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**：クエリされたパスが既にサブ列に抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルトVARIANTと同じ完全な列指向速度で読み取ります。
- **DOC Map**：クエリされたパスがまだマテリアライズされていない。クエリは値を見つけるために全体のdoc mapをスキャンすることにフォールバックします — 幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**：同じフォールバック、ただし`variant_doc_hash_shard_count`により、doc mapが複数の物理列に分散され、並列スキャンとはるかに高速な回復を可能にします。

**Storage Format V3。** 列メタデータをセグメントフッターから分離します。数千のサブ列が存在する場合にメタデータボトルネックを排除するため、特に幅広いJSONにおいて、あらゆる`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | キー設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを保持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパス少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（取り込み優先または全ドキュメント返却） | DOC mode + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型例：クエリが少数の馴染みのあるパスに繰り返し触れるイベントログや監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化するのに十分広いかどうかまだ確信が持てず、価値の大部分がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点:
- パスの増加が既に負荷を引き起こしている場合以外は、早期に`variant_max_subcolumns_count`を上げないでください。
- JSONが広くない場合、sparse columnsやDOCモードを有効にすると、メリットなしに複雑さが増します。

### Sparseモード

ペイロードが広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columnsを選択してください。

典型的な例：何千もの任意の属性を持つが、定期的にクエリされるのは数十のみである、広告、テレメトリ、またはプロフィールJSON。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、およびインデックス作成である場合に使用してください。

注意点：
- ホットパス解析がボトルネックの場合、最初にDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大きな抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を推奨します。

### DOC Mode {#doc-mode-template}

JSONドキュメント全体を返すことや取り込みオーバーヘッドの最小化が、パスベース解析の最適化よりも重要である場合にDOCモードを選択してください。

典型例：モデル応答、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSONドキュメント。

DOCモードが有効な場合：

- Subcolumnizationスケールが極めて大きくなる場合（10,000パスに近づく）、ハードウェア要件は急激に上昇します。この規模ではDOCモードがより安定した選択です。
- コンパクションメモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースワイドカラム取り込みワークロードでは、スループットが約5〜10倍向上する可能性があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムからドキュメントを再構築することを回避し、桁違いの高速化を実現します。

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
ingest スループットが最優先の場合、ワークロードが頻繁に完全な JSON ドキュメントを必要とする場合、または非常に幅の広いカラムが `SELECT variant_col` でよく読み取られる場合に使用します。

注意点：
- DOC モードは、すべての wide-JSON ワークロードに対するデフォルトの答えではありません。ホットパス分析が支配的な場合、通常は sparse columns の方が適しています。
- DOC モードと sparse columns は相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は Schema Template を選択します。

典型的な例：いくつかのビジネスクリティカルなパスが型付けされ検索可能な状態を維持する必要がある注文、支払い、またはデバイスペイロード。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合は、Schema Templateをスパース列やデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON スキーマ全体を静的テンプレートにしないでください。それでは`VARIANT`の意味がなくなります。
- Schema Template は重要なパスのみをカバーし、残りは動的なままにしておくべきです。

## パフォーマンス

以下のチャートは、10K パス幅のワイドカラムデータセット（200K 行、1つのキーを抽出、16 CPU、3回実行の中央値）でのシングルパス抽出時間を比較しています。

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

- **マテリアライズされたサブカラムが勝利。** Default と DOC Materialized の両方が約76 ms を達成 — 生の STRING より80倍高速、JSONB より12倍高速。
- **シャーディングを使った DOC Map が効果的。** doc map をシャーディングすることで、マテリアライズされていないパスのクエリ時間が2.5秒から148 ms に短縮されます。
- **JSONB と STRING はメモリを大量消費。** VARIANT モードの1 MiB に対し、32〜48 GiB のピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルには Storage Format V3 から開始してください。** V3 はカラムメタデータをセグメントフッターから分離します。これがないと、ワイド JSON ワークロードでファイルオープンの低速化と高いメモリオーバーヘッドに悩まされます。
- **Schema Template を使用して重要なパスを早期に固定してください。** Schema Template がない場合、システムは自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONB に昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状から調整してください。** ほとんどのワークロードでは、デフォルトで十分です。AI トレーニング、コネクテッドビークル、ユーザータグシステムなど、異常に大規模な Subcolumnization スケールと多くのパスレベルインデックスが必要なワークロードの場合のみ、シナリオに応じて調整してください。初日からの過度な設定（非常に大きな`variant_max_subcolumns_count`、不要な DOC モードの有効化）は、利益の証拠なしに複雑さを追加します。

### クエリフェーズ

- **非常にワイドな`VARIANT`カラムに対して`SELECT *`をメインクエリパターンとして使用しないでください。** DOC モード以外では、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きな JSON を再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに低速です。
- **クエリが型に依存する場合は、常にサブパスを CAST してください。** 型推論は期待と一致しない場合があります。`v['id']`が実際には STRING として保存されているのに整数リテラルと比較する場合、インデックスは使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視してください。** サブカラムの増加はマージコストを増加させます。Compaction Score が上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視してください。** JSON 構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Template で重要なパスをロックしてください。
- **型競合を監視してください。** 同じパスでの頻繁な型競合は、JSONB 昇格とインデックス損失を避けるため、Schema Template でそのパスをロックすべきであることを示しています。

## クイック検証

テーブル作成後、すべてが動作することを検証するために、この最小限のシーケンスを使用してください：

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
