---
{
  "title": "VARIANTワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、Schema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

新しい`VARIANT`ワークロードをモデル化する方法を決定する際にこのガイドを使用してください。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、静的列を使用すべきか？
- JSONが非常にワイドな場合、デフォルトの動作、スパース列、またはDOCモードから始めるべきか？
- どの設定をデフォルトのままにして、どの設定を最初に変更すべきか？

既に`VARIANT`を使用したいことが分かっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)に進んでください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)に進んでください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisは頻繁に使用されるパスに対してSubcolumnizationを適用することができます。これにより、事前に全体のドキュメントスキーマを固定することなく、一般的なフィルタ、集計、パスレベルのインデックスが適切に機能します。非常にワイドなJSONでは、ストレージ層の最適化により、はるかに大きなパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

以下のほとんどが当てはまる場合、`VARIANT`は通常適しています：

- 入力がJSONまたは時間の経過とともにフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- 列型分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要であるが、他の多くのパスは動的なままでよい。

以下の条件が支配的な場合は静的列を優先してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される。
- 主な要件がパスによる分析ではなく、生のJSONのアーカイブである。

## 最初の4つの質問

設定に触れる前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、DorisはそれらのパスにSubcolumnizationを適用し続けることができます。これは`VARIANT`が最も役立つ場合です。

### 2. 固定型や安定したインデックスが必要なパスがいくつかありますか？

はいの場合、それらのパスに対してのみSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールド向けであり、ドキュメント全体を記述するためのものではありません。

### 3. 本当にワイドJSONになっていますか？

パス数が増え続け、メタデータ圧力、コンパクション圧力、または顕著なクエリオーバーヘッドを生み出し始めた場合、ワイドJSONの問題があります。

### 4. ワイドJSONの場合、ホットパス分析とドキュメント全体の返却のどちらがより重要ですか？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集計、インデックスである場合は、スパース列を選択してください。
- 主な価値がインジェスト効率またはドキュメント全体の返却である場合は、DOCモードを選択してください。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** `VARIANT`列にデータが書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列型サブ列として抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`列の宣言。型付け、インデックス化、予測可能性が必要な主要ビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパス数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を始めた場合、ワイドJSONの問題があります。

**スパース列。** ワイドJSONに明確なホット/コールド分割がある場合、スパース列はホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。スパースストレージは、より良い読み取り並列性のために複数の物理列にわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立した列型サブ列として留まり、数千のロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**スパースシャーディング。** ロングテールパス数が非常に大きい場合、単一のスパース列が読み取りボトルネックになる可能性があります。スパースシャーディングは、ロングテールパスをハッシュによって複数の物理列（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延させ、さらに元のJSONをmap形式の格納フィールド（**doc map**）として保存します。これにより、追加のストレージコストで高速なインジェストと効率的なドキュメント全体の返却を実現します。Subcolumnizationはコンパクション中に後で発生します。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図のように、書き込み中はJSONが高速インジェストのためにDoc Storeにそのまま保存されます。サブ列はコンパクション中に後で抽出されます。読み取り時、パスベースクエリ（例：`SELECT v['user_id']`）は完全な列型速度でマテリアライズされたサブ列から読み取り、ドキュメント全体クエリ（`SELECT v`）はサブ列から再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされるパスがマテリアライズされているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされるパスが既にサブ列に抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトVARIANTと同様に、完全な列型速度で読み取ります。
- **DOC Map**: クエリされるパスがまだマテリアライズされていない。クエリは値を見つけるためにdoc map全体をスキャンするフォールバックを行います—ワイドJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**: 同じフォールバックですが、`variant_doc_hash_shard_count`でdoc mapが複数の物理列に分散され、並列スキャンとはるかに高速な復旧が可能になります。

**Storage Format V3。** 列メタデータをセグメントフッターから分離します。数千のサブ列が存在する場合のメタデータボトルネックを排除するため、すべての`VARIANT`テーブル、特にワイドJSONに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

以下の表を使用して開始点を選択し、対応するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリー/ユーザープロファイル（ワイド、ホットパスが少ない） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先またはドキュメント全体返却） | DOC mode + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみを定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型例：クエリがいくつかの馴染みのあるパスに繰り返しアクセスするイベントログや監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化するほど十分に幅広いかどうかまだ確信が持てず、ほとんどの価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点：
- パスの増大が既に負荷を引き起こしている場合を除き、早期に`variant_max_subcolumns_count`を上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると利益なしに複雑性が増します。

### Sparse Mode

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columnsを選択してください。

典型的な例：数千のオプション属性を持つが定期的にクエリされるのは数十個のみの広告、テレメトリ、またはプロファイルJSON。

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
総キー数が非常に大きいが、主要なワークロードがパスベースのフィルタリング、集約、インデックス化である場合に使用します。

注意点:
- ホットパス分析がボトルネックの場合、最初にDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を推奨します。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや取り込みオーバーヘッドの最小化が、パス ベース分析の最適化よりも重要な場合にDOCモードを選択します。

典型的な例: モデル応答、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合:

- Subcolumnizationスケールが極めて大きくなると（10,000パスに近づくと）、ハードウェア要件が急速に増加します。この規模ではDOCモードがより安定した選択です。
- コンパクション メモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースワイドカラム取り込みワークロードでは、スループットが約5〜10倍向上する可能性があります。
- クエリが`VARIANT`値全体（`SELECT variant_col`）を読み取る場合、DOCモードは数千のサブカラムから文書を再構築することを回避し、桁違いの高速化を実現します。

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
ingest スループットが最優先である場合、ワークロードが頻繁に完全な JSON ドキュメントを必要とする場合、または `SELECT variant_col` で非常に幅広い列がしばしば読み取られる場合に使用してください。

注意点:
- DOC モードは、すべての幅広い JSON ワークロードに対するデフォルトの答えではありません。ホットパス分析が支配的な場合、通常はスパース列の方が適しています。
- DOC モードとスパース列は相互に排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は、Schema Template を選択してください。

典型的な例: 注文、支払い、またはデバイスペイロードで、ビジネスクリティカルなパスが型付けされ検索可能な状態を維持する必要がある場合。

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
重要なビジネスクリティカルなフィールドが少数のみで、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合はSchema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSONスキーマ全体を静的テンプレートにしないでください。それでは`VARIANT`の意味がありません。
- Schema Templateはキーパスのみをカバーし、残りは動的のままにします。

## パフォーマンス

以下のチャートは、10K パス幅のワイドカラムデータセット（20万行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

主なポイント：

- **マテリアライズされたサブカラムが勝利。** DefaultとDOC Materializedの両方が約76 msを実現 — 生のSTRINGより80倍高速、JSONBより12倍高速。
- **シャーディングされたDOC Mapが効果的。** ドキュメントマップをシャーディングすることで、マテリアライズされていないパスのクエリ時間が2.5秒から148 msに短縮。
- **JSONBとSTRINGはメモリ使用量が多い。** VARIANTモードの1 MiBに対して32-48 GiBのピークメモリを消費。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルにはStorage Format V3から始める。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、幅広いJSONワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが大きくなります。
- **Schema Template経由でキーパスを早期にピン留めする。** Schema Templateがないと、システムが自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状から調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI学習、コネクテッドビークル、ユーザータグシステムなど、異常に大きなSubcolumnizationスケールと多くのパスレベルインデックスが必要なワークロードでのみ、シナリオ別に調整してください。初日から過度に設定すること（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）は、利益の証拠なしに複雑さを追加します。

### クエリフェーズ

- **非常に幅広い`VARIANT`カラムでメインのクエリパターンとして`SELECT *`を使用しない。** DOCモードなしでは、`SELECT *`または`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスをCASTする。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているが、整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクションの負荷を監視する。** サブカラムの増大によりマージコストが増加します。Compaction Scoreが上昇し続ける場合は、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、急激なクエリの遅延を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型の競合を監視する。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにSchema Template経由でそのパスをロックすべきであることを示しています。

## クイック検証

テーブル作成後、以下の最小限のシーケンスを使用してすべてが動作することを確認してください：

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
