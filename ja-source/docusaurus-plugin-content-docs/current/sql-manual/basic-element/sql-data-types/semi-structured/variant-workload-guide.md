---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをモデリングする方法を決定する際に使用してください。次のような質問に回答するのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、静的カラムを使用すべきか？
- JSONが非常に幅広い場合、デフォルト動作、sparse columns、またはDOCモードから開始すべきか？
- どの設定をデフォルトのままにし、どの設定を最初に変更すべきか？

既に`VARIANT`を使用することが決定しており、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選択する理由
`VARIANT`はJSONの柔軟性を保持しつつ、DorisはSubcolumnizationを頻繁に使用されるパスに適用することができます。これにより、一般的なフィルタ、集約、パスレベルのインデックスが、事前に文書スキーマ全体を固定することなく効率的に動作します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに多くのパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適用される場面

`VARIANT`は通常、以下の大部分が当てはまる場合に適しています：

- 入力がJSONまたは時間の経過とともにフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに対して実行される。
- カラム分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が支配的な場合は、静的カラムを選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別の分析ではなく、生JSONのアーカイブである。

## 最初の4つの質問

設定に触れる前に、これらの4つの質問に答えてください。

### 1. 明確なホットパスは存在するか？

クエリが同じJSONパスを繰り返し参照する場合、Dorisはそれらのパスに対してSubcolumnizationを継続的に適用できます。これが`VARIANT`が最も効果を発揮する場面です。

### 2. 少数のパスに固定型や安定したインデックスが必要か？

必要な場合は、それらのパスのみにSchema Templateを使用してください。これは少数のビジネス重要なフィールド用であり、文書全体を記述するためのものではありません。

### 3. 本当に幅広いJSONになっているか？

パス数が増加し続け、メタデータの負荷、コンパクション負荷、または顕著なクエリオーバーヘッドが発生し始めると、幅広いJSONの問題が生じます。

### 4. 幅広いJSONの場合、ホットパス分析と文書全体の返却のどちらがより重要か？

- 主な価値がホットフィールドに対するパスベースのフィルタリング、集約、インデックス化である場合は、sparse columnsに傾く。
- 主な価値がインジェスト効率や文書全体の返却である場合は、DOCモードに傾く。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。各用語は2～3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** `VARIANT`カラムにデータが書き込まれると、Dorisは自動的にJSONパスを発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`カラム上の宣言。型付け、インデックス化、予測可能性を維持する必要があるキービジネスフィールドに使用します。すべての可能なパスを列挙しようとしないでください。

**幅広いJSON。** 異なるパスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始する場合、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールド分割がある場合、sparse columnsはホットパスをSubcolumnizationに保持しつつ、コールド（ロングテール）パスを共有sparse storageに押し込みます。Sparse storageは読み取り並列性を向上させるため、複数の物理カラムにわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして残り、数千のロングテールパスは共有sparse storageに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に多い場合、単一のsparse columnが読み取りボトルネックになることがあります。Sparse shardingは、ロングテールパスをハッシュによって複数の物理カラム（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延し、さらに元のJSONをmap形式の格納フィールド（**doc map**）として保存します。これにより、追加ストレージのコストで高速インジェストと効率的な文書全体の返却を実現します。Subcolumnizationは後のコンパクション中に実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み中にJSONは高速インジェストのためにDoc Storeにそのまま保存されます。サブカラムはコンパクション中に後で抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は物質化されたサブカラムから完全なカラム速度で読み取り、文書全体のクエリ（`SELECT v`）はサブカラムから再構築することなく、Doc Storeから直接読み取ります。

DOCモードには、クエリされたパスが物質化されているかどうかに応じて、3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**：クエリされたパスが既にサブカラムに抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルトVARIANTと同じ、完全なカラム速度で読み取り。
- **DOC Map**：クエリされたパスがまだ物質化されていない。クエリは値を見つけるために、doc map全体をスキャンするフォールバックを行う — 幅広いJSONでは大幅に遅い。
- **DOC Map (Sharded)**：同じフォールバック、ただし`variant_doc_hash_shard_count`により、doc mapが複数の物理カラムに分散され、並列スキャンと大幅に高速な復旧を可能にする。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。特に幅広いJSONの場合、数千のサブカラムが存在する際のメタデータボトルネックを排除するため、すべての`VARIANT`テーブルで推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選択するために下表を使用し、該当するセクションを読んでください。

| | 一般的なシナリオ | 推奨モード | キー設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告 / テレメトリ / ユーザープロファイル（幅広く、ホットパスが少ない） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力 / トレース / アーカイブ（インジェスト優先または文書全体の返却） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文 / 決済 / デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

一般的な例：クエリがいくつかの馴染みのあるパスを繰り返し参照するイベントログや監査ペイロード。

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
ワークロードが sparse columns や DOC mode を正当化するほど十分に広いかどうかまだ確信が持てず、ほとんどの価値がいくつかの共通パスでのフィルタリング、集計、グループ化から得られる場合に使用してください。

注意点:
- パスの増加が既に負荷を引き起こしている場合を除き、早期に `variant_max_subcolumns_count` を上げないでください。
- JSON が広くない場合、sparse columns や DOC mode を有効にすることは利益なしに複雑さを追加します。

### Sparse Mode

ペイロードが広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は sparse columns を選択してください。

典型的な例: 数千のオプション属性を持つが、定期的にクエリされるのは数十のみの広告、テレメトリ、またはプロファイル JSON。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集計、およびインデックス化である場合に使用します。

注意点：
- ホットパス分析がボトルネックである場合は、最初にDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を選択してください。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや、パスベース分析の最適化よりも取り込みオーバーヘッドの最小化が重要な場合は、DOCモードを選択してください。

典型例：モデル応答、トレーススナップショット、または完全なペイロードとして頻繁に返されるアーカイブ済みJSON文書。

DOCモードが有効な場合：

- Subcolumnizationスケールが極めて大規模になる場合（10,000パスに近づく場合）、ハードウェア要件が急速に増加します。この規模ではDOCモードがより安定した選択肢です。
- コンパクション メモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5～10倍向上する可能性があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムから文書を再構築することを回避し、桁違いの高速化を実現します。

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
ingest のスループットが最優先である場合、ワークロードで完全な JSON ドキュメントを頻繁に取得する必要がある場合、または `SELECT variant_col` で非常に幅の広い列を頻繁に読み取る場合に使用します。

注意点：
- DOC モードは、すべての幅広い JSON ワークロードに対するデフォルトの解決策ではありません。ホットパス分析が主要である場合、通常はスパース列の方が適しています。
- DOC モードとスパース列は相互に排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は Schema Template を選択します。

典型的な例：注文、支払い、またはデバイスのペイロードで、いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合は、Schema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON スキーマ全体を静的テンプレートにしないでください。`VARIANT`の意味がなくなります。
- Schema Template は主要パスのみをカバーし、残りは動的なままにしてください。

## パフォーマンス

以下のチャートは、10K パス幅の広いカラムデータセット（200K 行、1 つのキーを抽出、16 CPU、3 回実行の中央値）での単一パス抽出時間を比較したものです。

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

- **マテリアライズされたサブカラムが勝利。** Default と DOC Materialized の両方で約 76 ms を実現 — 生の STRING より 80 倍高速、JSONB より 12 倍高速。
- **シャーディングを使用した DOC Map が効果的。** doc map をシャーディングすることで、マテリアライズされていないパスのクエリ時間が 2.5 秒から 148 ms に短縮されます。
- **JSONB と STRING はメモリ使用量が多い。** VARIANT モードの 1 MiB に対して、32–48 GiB のピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **新しい `VARIANT` テーブルには Storage Format V3 から始める。** V3 はカラムメタデータをセグメントフッターから分離します。これがないと、幅の広い JSON ワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが高くなります。
- **Schema Template を使用して早期に主要パスを固定する。** Schema Template がないと、システムは自動的に型を推測します。同じパスがバッチ間で型が変わる場合（例：整数から文字列）、JSONB に昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状に応じて調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI トレーニング、コネクテッドビークル、ユーザータグシステムなどのワークロードで異常に大きな Subcolumnization スケールと多くのパスレベルインデックスが必要な場合のみ、シナリオ別に調整してください。初日から過度に設定すること（非常に大きな `variant_max_subcolumns_count`、不要時の DOC モード有効化）は、利益の証拠がないまま複雑さを増します。

### クエリフェーズ

- **非常に幅の広い `VARIANT` カラムのメインクエリパターンとして `SELECT *` を使用しない。** DOC モードなしでは、`SELECT *` や `SELECT variant_col` はすべてのサブカラムから大きな JSON を再構築する必要があり、`SELECT v['path']` のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスを CAST する。** 型推測は期待と一致しない場合があります。`v['id']` が実際には STRING として格納されているが整数リテラルと比較する場合、インデックスは使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視する。** サブカラムの増加はマージコストを増加させます。Compaction Score が上昇し続ける場合は、`variant_max_subcolumns_count` が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視する。** JSON 構造が頻繁に変わる場合、ホットパスがスパースストレージに押し込まれ、クエリの突然の低速化を引き起こす可能性があります。Schema Template で重要なパスをロックしてください。
- **型競合を監視する。** 同じパスでの頻繁な型競合は、JSONB 昇格とインデックス喪失を避けるためにそのパスを Schema Template でロックすべきことを示しています。

## クイック検証

テーブル作成後、以下の最小限のシーケンスを使用してすべてが正常に動作することを確認してください：

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
