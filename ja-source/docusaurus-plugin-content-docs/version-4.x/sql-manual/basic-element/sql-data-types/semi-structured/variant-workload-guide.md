---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTをいつ使用するか、default、sparse、DOCモード、およびSchema Templateの中からどれを選択するか、そして設定をどこから始めるかの判断ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

新しい`VARIANT`ワークロードのモデリング方法を決定する際は、このガイドをご使用ください。以下のような質問への回答に役立ちます：

- このワークロードは`VARIANT`を使用すべきか、静的カラムを使用すべきか？
- JSONが非常に幅広い場合、デフォルト動作、sparse columns、DOC modeのどれから始めるべきか？
- どの設定をデフォルトのまま残し、どの設定を最初に変更すべきか？

すでに`VARIANT`を使用することが決まっており、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)をご覧ください。実行可能な最小のインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)をご覧ください。

:::tip なぜVARIANTを選ぶのか
`VARIANT`はJSONの柔軟性を保ちながら、DorisはSubcolumnizationを頻繁に使用されるパスに適用できます。これにより、一般的なフィルタ、集約、パスレベルのインデックスが、事前にドキュメントスキーマ全体を固定することなく、効率的に機能します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに多くのパス数でSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

通常、以下の条件の大部分が当てはまる場合、`VARIANT`が適しています：

- 入力がJSONまたはその他の半構造化ペイロードで、フィールドが時間の経過とともに発展する。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- カラムナル分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要。
- 一部のパスにはインデックスが必要で、その他の多くのパスは動的なままで良い。

以下の条件が支配的な場合は、静的カラムを優先してください：

- スキーマが安定しており、事前に既知である。
- コアフィールドが定期的に結合キー、ソートキー、または厳密に制御された型付きカラムとして使用される。
- 主な要件がパス別の分析ではなく、生JSONのアーカイブである。

## 最初の4つの質問

設定を変更する前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、Dorisはそれらのパスに継続的にSubcolumnizationを適用できます。これが`VARIANT`が最も役立つ場面です。

### 2. 固定型や安定したインデックスが必要なパスはありますか？

はいの場合、該当するパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールドのためのものであり、ドキュメント全体を記述するためのものではありません。

### 3. 本当に幅広いJSONになっていますか？

パス数が増加し続け、メタデータの負荷、コンパクション負荷、または顕著なクエリオーバーヘッドを生じ始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、ホットパス分析とドキュメント全体の返却のどちらがより重要ですか？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集約、インデックス作成である場合は、sparse columnsに傾きます。
- 主な価値がインジェスト効率やドキュメント全体の返却である場合は、DOC modeに傾きます。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれは2〜3行で説明されており、実装の詳細については[VARIANT](./VARIANT)をご覧ください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれる際、DorisはJSONパスを自動的に検出し、ホットパスを効率的な分析のための独立したカラムナルサブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** `VARIANT`カラムで選択されたパスを安定した型に固定する宣言。型付け、インデックス化、予測可能性が必要なキービジネスフィールドに使用してください。可能なすべてのパスを列挙しようとはしないでください。

**Wide JSON。** 異なるパスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始したときに、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールドの分離がある場合、sparse columnsはホットパスをSubcolumnizationに保持しながら、コールド（ロングテール）パスを共有sparse storageにプッシュします。Sparse storageは、より良い読み取り並列性のために複数の物理カラムへのシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラムナルサブカラムとして残り、数千のロングテールパスは共有sparse storageに収束します。閾値は`variant_max_subcolumns_count`で制御されます。

**Sparse sharding。** ロングテールパス数が非常に多い場合、単一のsparse columnが読み取りボトルネックになる可能性があります。Sparse shardingはロングテールパスをハッシュによって複数の物理カラム（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOC mode。** 書き込み時のSubcolumnizationを遅延し、さらに元のJSONをmap形式の格納フィールド（**doc map**）として保存します。これにより、追加ストレージのコストで高速なインジェストと効率的なドキュメント全体の返却を実現します。Subcolumnizationは後にコンパクション中に実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み中はJSONがそのままDoc Storeに保存され、高速なインジェストを実現します。サブカラムは後にコンパクション中に抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全なカラムナル速度で実体化されたサブカラムから読み取り、ドキュメント全体のクエリ（`SELECT v`）はサブカラムから再構築することなく、Doc Storeから直接読み取ります。

DOC modeは、クエリされたパスが実体化されているかどうかに応じて、3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスが既にサブカラムに抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトのVARIANTと同様に、完全なカラムナル速度で読み取り。
- **DOC Map**: クエリされたパスがまだ実体化されていない。クエリは値を見つけるためにdoc map全体をスキャンするフォールバックとなり、幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**: 同じフォールバックですが、`variant_doc_hash_shard_count`でdoc mapが複数の物理カラムに分散され、並列スキャンとはるかに高速なリカバリが可能になります。

**Storage Format V3。** カラムメタデータをセグメントフッターから切り離します。特に幅広いJSONにおいて、数千のサブカラムが存在する際のメタデータボトルネックを排除するため、すべての`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶには以下の表を使用し、該当するセクションをお読みください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパスは少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先またはドキュメント全体の返却） | DOC mode + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + A または B | キーパスのみを定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型例：クエリが繰り返し少数の馴染みのあるパスにアクセスするイベントログまたは監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化するのに十分な幅があるかどうかまだ確信が持てない場合、そしてほとんどの価値がいくつかの一般的なパスでのフィルタリング、集約、グループ化から得られる場合に使用します。

注意点:
- パスの増大が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると利益なしに複雑性が増します。

### Sparseモード

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合にsparse columnsを選択してください。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、およびインデックス化である場合に使用してください。

注意点:
- ホットパス分析がボトルネックの場合は、最初にDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルト値は`2048`で、これは既にほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。事実上すべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を選択してください。

### DOC Mode {#doc-mode-template}

JSONドキュメント全体を返すことや取り込みオーバーヘッドの最小化が、パスベース分析の最適化よりも重要な場合にDOCモードを選択してください。

典型的な例: モデル応答、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSONドキュメント。

DOCモードが有効な場合:

- Subcolumnizationスケールが極端に大きくなる場合（10,000パスに近づく）、ハードウェア要件が急速に増加します。DOCモードはこのスケールでより安定した選択肢です。
- コンパクションメモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースワイドカラム取り込みワークロードにおいて、スループットが約5～10倍改善される可能性があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムからドキュメントを再構築することを回避し、桁違いの高速化を実現します。

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
ingest スループットが最優先の場合、ワークロードで完全な JSON ドキュメントを頻繁に取得する必要がある場合、または非常に幅の広いカラムを `SELECT variant_col` でよく読み取る場合に使用します。

注意点:
- DOC モードは、すべての幅の広い JSON ワークロードに対するデフォルトの答えではありません。ホットパス分析が支配的な場合、通常はスパースカラムの方が適しています。
- DOC モードとスパースカラムは相互に排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は、Schema Template を選択してください。

典型的な例: 注文、支払い、またはデバイスのペイロードで、ビジネスクリティカルないくつかのパスが型付けされ検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。適切な場合はSchema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせます。

注意点：
- JSON schema全体を静的テンプレートに変換しないでください。これでは`VARIANT`の意味がなくなります。
- Schema Templateは主要パスのみをカバーし、残りは動的のままにしておきます。

## パフォーマンス

以下のチャートは10Kパスのワイドカラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

- **マテリアライズされたサブカラムが勝利。** DefaultとDOC Materializedの両方が約76 msを実現 — 生のSTRINGより80倍、JSONBより12倍高速。
- **DOC Mapとシャーディングが効果的。** docマップをシャーディングすることで、非マテリアライズパスのクエリ時間が2.5秒から148 msに短縮。
- **JSONBとSTRINGはメモリを大量消費。** VARIANTモードの1 MiBに対し、32〜48 GiBのピークメモリを消費。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルにはStorage Format V3から開始する。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、ワイドJSONワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが高くなります。
- **Schema Templateで主要パスを早期に固定する。** Schema Templateなしでは、システムが型を自動推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整する。** ほとんどのワークロードではデフォルトで十分です。AI学習、コネクテッドカー、ユーザータグシステムなど、異常に大きなSubcolumnizationスケールと多数のパスレベルインデックスが必要なワークロードの場合のみ、シナリオ別に調整します。初日から過度に設定する（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）と、利益の証拠なしに複雑性が増します。

### クエリフェーズ

- **非常にワイドな`VARIANT`カラムに対する主要なクエリパターンとして`SELECT *`を使用しない。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は常にサブパスをCASTする。** 型推論が期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして保存されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違う可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視する。** サブカラムの増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認します。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要パスをロックします。
- **型競合を監視する。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにSchema Templateでパスをロックすべきであることを示します。

## 簡単検証

テーブル作成後、すべてが正常に動作することを検証するために以下の最小限のシーケンスを使用します：

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
