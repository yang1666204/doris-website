---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に使用してください。以下のような質問への回答に役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的列を使用すべきか？
- JSONが非常に幅広い場合、デフォルトの動作、スパース列、DOCモードのどれから始めるべきか？
- どの設定をデフォルトのままにして、どれを最初に変更すべきか？

既に`VARIANT`を使用することが決まっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisは頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、文書スキーマ全体を事前に固定することなく、一般的なフィルタ、集約、パスレベルインデックスが効率的に動作します。非常に幅広いJSONでは、ストレージレイヤーの最適化により、はるかに多くのパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適する場合

以下の条件の大部分が当てはまる場合、通常`VARIANT`が適しています：

- 入力がJSONまたは時間の経過とともにフィールドが変化する他の半構造化ペイロードである
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる
- 列指向分析パフォーマンスを諦めることなく、スキーマの柔軟性が欲しい
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい

以下の条件が主となる場合は静的列を選択してください：

- スキーマが安定しており、事前に分かっている
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される
- 主な要件が、パスによる分析ではなく、生のJSONをアーカイブすることである

## まず4つの質問

設定に触れる前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、DorisはそれらのパスにSubcolumnizationを継続的に適用できます。これが`VARIANT`が最も役立つ場面です。

### 2. いくつかのパスに固定型または安定したインデックスが必要ですか？

必要な場合は、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールド用であり、文書全体を記述するためのものではありません。

### 3. これは本当に幅広いJSONになっていますか？

パス数が増え続け、メタデータの圧迫、コンパクション圧迫、または顕著なクエリオーバーヘッドを生じ始めた場合、幅広いJSON問題があります。

### 4. 幅広いJSONの場合、ホットパス分析と文書全体の返却のどちらが重要ですか？

- 主な価値がパスベースのフィルタリング、集約、ホットフィールドのインデックシングにある場合は、スパース列に傾く
- 主な価値がインジェスト効率または文書全体の返却にある場合は、DOCモードに傾く

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されており、実装の詳細については[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`列に書き込まれるとき、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列指向サブ列として抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`列の宣言です。型付け、インデックス化、予測可能性を維持する必要がある主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を引き起こし始めた場合、幅広いJSON問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールドの分離がある場合、スパース列はホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有スパースストレージに押し込みます。スパースストレージは、より良い読み取り並列性のために複数の物理列間でのシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立した列指向サブ列として残り、何千ものロングテールパスが共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のスパース列が読み取りボトルネックになる可能性があります。スパースシャーディングは、ロングテールパスをハッシュによって複数の物理列（`variant_sparse_hash_shard_count`）に分散させ、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOC mode。** 書き込み時にSubcolumnizationを遅延させ、さらに元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これは追加ストレージのコストで高速インジェストと効率的な文書全体の返却を提供します。Subcolumnizationはコンパクション中に後で実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図のように、書き込み時にJSONはDoc Storeにそのまま保存され、高速インジェストを実現します。サブ列はコンパクション中に後で抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全な列指向速度で実体化されたサブ列から読み取り、文書全体のクエリ（`SELECT v`）はサブ列から再構成することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスが実体化されているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**：クエリされたパスが既にサブ列に抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルトのVARIANTと同じ、完全な列指向速度で読み取り。
- **DOC Map**：クエリされたパスがまだ実体化されていない。クエリは値を見つけるためにdoc map全体をスキャンすることにフォールバック — 幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**：同じフォールバックですが、`variant_doc_hash_shard_count`によりdoc mapが複数の物理列に分散され、並列スキャンとはるかに高速な回復が可能になります。

**Storage Format V3。** 列メタデータをセグメントフッターから分離します。特に幅広いJSONの場合、数千のサブ列が存在する際のメタデータボトルネックを排除するため、すべての`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広く、ホットパスは少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先または文書全体返却） | DOC mode + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + A or B | キーパスのみ定義 |

### デフォルトモード

これは大部分の新しい`VARIANT`ワークロードにとって最も安全な開始点です。

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
ワークロードがsparse columnsやDOCモードを正当化するのに十分な幅を持つかどうかまだ確信がなく、大部分の価値がいくつかの共通パスでのフィルタリング、集約、グルーピングから依然として得られる場合に使用します。

注意点:
- パスの増加が既に負荷を引き起こしている場合でない限り、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると利益なしに複雑さが追加されます。

### Sparse Mode

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columnsを選択します。

典型的な例: 数千のオプション属性を持つが定期的にクエリされるのは数十個のみの広告、テレメトリ、またはプロファイルJSON。

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
総キー数が非常に多いが、主要なワークロードがパスベースのフィルタリング、集約、およびインデックス処理である場合に使用してください。

注意点：
- ホットパス分析がボトルネックの場合は、まずDOCモードにジャンプしないでください。
- `variant_max_subcolumns_count`のデフォルト値は`2048`で、これはほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOCモード](#doc-mode-template)を推奨します。

### DOCモード {#doc-mode-template}

JSON文書全体を返すことや、パスベース分析の最適化よりも取り込みオーバーヘッドの最小化が重要な場合は、DOCモードを選択してください。

典型的な例：モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが役立つ場面：

- Subcolumnizationスケールが極めて大きくなる場合（10,000パスに近づく）、ハードウェア要件が急速に増大します。この規模では、DOCモードがより安定した選択肢です。
- コンパクションメモリは、デフォルトの積極的なSubcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5～10倍向上する可能性があります。
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
ingest スループットが最優先の場合、ワークロードで完全な JSON ドキュメントを頻繁に取得する必要がある場合、または `SELECT variant_col` で非常に幅広いカラムを頻繁に読み取る場合に使用します。

注意点:
- DOC モードは、すべての wide-JSON ワークロードに対するデフォルトの解決策ではありません。ホットパス分析が主要な場合、通常は sparse columns の方が適しています。
- DOC モードと sparse columns は相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は Schema Template を選択してください。

典型的な例: いくつかのビジネス クリティカルなパスが型付けされ、検索可能な状態を維持する必要がある order、payment、または device ペイロード。

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
ビジネスクリティカルなフィールドが少数のみで、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。適切な場合は、Schema Templateをスパース列やデフォルトの`VARIANT`と組み合わせます。

注意点：
- JSON スキーマ全体を静的テンプレートに変換しないでください。これは`VARIANT`の意味を無くします。
- Schema Template は主要なパスのみをカバーし、残りは動的なままにする必要があります。

## パフォーマンス

以下のチャートは、10K パス幅カラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

- **マテリアライズされたサブカラムが勝利。** Default と DOC Materialized の両方が約76 ms を達成 — 生のSTRINGより80倍高速、JSONBより12倍高速。
- **シャーディングを使用したDOC Mapが有効。** doc map をシャーディングすることで、マテリアライズされていないパスのクエリ時間が2.5秒から148 msに短縮されます。
- **JSONBとSTRINGはメモリを大量消費。** VARIANTモードの1 MiBに対して、32-48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルには Storage Format V3 から始める。** V3 はカラムメタデータをセグメントフッターから分離します。これがないと、幅広いJSONワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが高くなります。
- **Schema Template を通じて早期に主要パスを固定する。** Schema Template がないと、システムは自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状から調整する。** ほとんどのワークロードでは、デフォルトで十分です。AIトレーニング、コネクテッドカー、ユーザータグシステムなどのワークロードが異常に大きなSubcolumnization スケールと多くのパスレベルインデックスを必要とする場合のみ、シナリオ別に調整してください。初日からの過剰設定（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）は、利益の証拠なしに複雑さを追加します。

### クエリフェーズ

- **非常に幅広い`VARIANT`カラムのメインクエリパターンとして`SELECT *`を使用しない。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`は全てのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスをCASTする。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして保存されているが整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視する。** サブカラムの増加はマージコストを増加させます。Compaction Score が上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Template で重要なパスをロックしてください。
- **型競合を監視する。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにSchema Template でパスをロックすべきであることを示しています。

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
