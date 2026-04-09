---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスに対してサブカラム化を適用します。

このガイドは、新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に使用します。以下のような質問への回答に役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが非常にワイドな場合、デフォルトの動作、スパースカラム、DOCモードのどれから始めるべきか？
- どの設定をデフォルトのままにし、どれを最初に変更すべきか？

すでに`VARIANT`を使いたいことが分かっていて、構文や型規則のみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisが頻繁に使用されるパスに対してサブカラム化を適用できます。これにより、ドキュメントスキーマ全体を事前に固定することなく、一般的なフィルタ、集約、パスレベルのインデックスが効果的に機能します。非常にワイドなJSONでは、ストレージレイヤーの最適化により、はるかに大きなパス数でもサブカラム化を実用的に保つことができます。
:::

## VARIANTが適する場合

`VARIANT`は通常、以下の条件の大部分が当てはまる場合に適しています：

- 入力がJSONまたは他の半構造化ペイロードで、そのフィールドが時間とともに進化する。
- クエリが通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- カラム分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が優勢な場合は静的カラムを選択してください：

- スキーマが安定しており、事前に知られている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパスごとの分析ではなく、生のJSONをアーカイブすることである。

## 最初に答える4つの質問

設定に触れる前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスがあるか？

クエリが同じJSONパスに繰り返しアクセスする場合、Dorisはそれらのパスにサブカラム化を継続的に適用できます。これが`VARIANT`が最も役立つ場面です。

### 2. いくつかのパスに固定型や安定したインデックスが必要か？

必要な場合は、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールドを対象としており、ドキュメント全体を記述するためのものではありません。

### 3. 本当にワイドなJSONになっているか？

パス数が増え続け、メタデータの負荷、コンパクション負荷、または顕著なクエリオーバーヘッドを引き起こし始めた場合、ワイドJSON問題が発生しています。

### 4. ワイドJSONの場合、何がより重要か：ホットパス分析か全ドキュメント返却か？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集約、インデックス作成にある場合は、スパースカラムに傾ける。
- 主な価値がインジェスト効率または全ドキュメントの返却にある場合は、DOCモードに傾ける。

## 主要概念

以下のストレージモードを読む前に、これらの用語を明確にしてください。それぞれは2〜3行で説明されており、実装の詳細については[VARIANT](./VARIANT)を参照してください。

**サブカラム化。** `VARIANT`カラムにデータが書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`カラムの宣言。型付き、インデックス可能、予測可能であることが必要な重要なビジネスフィールドに使用します。すべての可能なパスを列挙しようとしないでください。

**ワイドJSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を引き起こし始めた場合、ワイドJSON問題が発生しています。

**スパースカラム。** ワイドJSONに明確なホット/コールドの分離がある場合、スパースカラムはホットパスをサブカラム化に保ちながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。スパースストレージは、より良い読み取り並列性のために複数の物理カラムにわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして維持され、数千のロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**スパースシャーディング。** ロングテールパス数が非常に大きい場合、単一のスパースカラムが読み取りボトルネックになる可能性があります。スパースシャーディングは、ロングテールパスをハッシュにより複数の物理カラム（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にサブカラム化を遅延させ、加えて元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加のストレージコストと引き換えに、高速なインジェストと効率的な全ドキュメント返却を実現します。サブカラム化は後でコンパクション中に実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図のように、書き込み中はJSONが高速インジェストのためにDoc Storeにそのまま保存されます。サブカラムは後でコンパクション中に抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全なカラム速度でマテリアライズされたサブカラムから読み取り、全ドキュメントクエリ（`SELECT v`）はサブカラムから再構築することなく、Doc Storeから直接読み取ります。

DOCモードには、クエリされたパスがマテリアライズされているかどうかに応じて、3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**：クエリされたパスがすでにサブカラムに抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトの`VARIANT`と同様に、完全なカラム速度で読み取り。
- **DOC Map**：クエリされたパスがまだマテリアライズされていない。クエリは値を見つけるためにdoc map全体をスキャンするフォールバックを行う — ワイドJSONでは大幅に遅くなる。
- **DOC Map (Sharded)**：同じフォールバックだが、`variant_doc_hash_shard_count`でdoc mapが複数の物理カラムに分散され、並列スキャンとはるかに高速な回復を可能にする。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。特にワイドJSONの場合、数千のサブカラムが存在する際のメタデータボトルネックを排除するため、すべての`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために以下のテーブルを使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | デフォルトVARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（ワイド、ホットパス少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先または全ドキュメント返却） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみを定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリがいくつかの馴染みのあるパスに繰り返しアクセスするイベントログまたは監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化するほど十分に広いかどうかまだ確信が持てず、価値の大部分がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点：
- パスの増加が既に負荷を引き起こしている場合を除き、早期に`variant_max_subcolumns_count`を上げないでください。
- JSONが広くない場合、sparse columnsやDOCモードを有効にすると利益なしに複雑性が追加されます。

### Sparseモード

ペイロードが広いが、ほとんどのクエリが少数のホットパスに焦点を当てている場合はsparse columnsを選択してください。

典型的な例：数千のオプション属性を持つが、定期的にクエリされるのは数十個のみの広告、テレメトリ、またはプロファイルJSON。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、インデックス化である場合に使用してください。

注意点:
- ホットパス解析がボトルネックの場合は、最初にDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルト値は`2048`で、これはほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。すべてのパスが実質的にSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大きな抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を推奨します。

### DOC Mode {#doc-mode-template}

パスベース解析の最適化よりも、JSONドキュメント全体を返すことや取り込みオーバーヘッドの最小化が重要な場合にDOCモードを選択してください。

典型的な例：モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSONドキュメント。

DOCモードが有効な場合：

- Subcolumnizationスケールが極端に大きくなる場合（10,000パスに近づく場合）、ハードウェア要件が急激に増加します。この規模ではDOCモードがより安定した選択肢です。
- コンパクション メモリは、デフォルトの積極的Subcolumnizationと比較して約3分の2削減できます。
- スパースワイドカラム取り込みワークロードでは、スループットが約5～10倍改善される可能性があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムからドキュメントを再構築することを回避し、桁違いの高速化を実現します。

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
インジェストのスループットが最優先事項である場合、ワークロードで完全なJSONドキュメントを頻繁に取得する必要がある場合、または非常に幅広いカラムを`SELECT variant_col`で読み取ることが多い場合に使用してください。

注意点：
- DOCモードは、すべての幅広いJSONワークロードに対するデフォルトの解決策ではありません。ホットパス分析が主要な場合は、通常スパースカラムの方が適しています。
- DOCモードとスパースカラムは相互に排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は、Schema Templateを選択してください。

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
ビジネスクリティカルなフィールドが少数のみ存在し、それらのパスでより厳密な型指定やパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合はSchema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON スキーマ全体を静的なテンプレートにしないでください。それは`VARIANT`の意味を失わせます。
- Schema Templateは主要なパスのみをカバーし、残りは動的なままにしておく必要があります。

## パフォーマンス

以下のチャートは、10Kパス幅のワイドカラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）でのシングルパス抽出時間を比較しています。

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

主な結論：

- **マテリアライズされたサブカラムが勝利。** DefaultとDOC Materializedの両方が約76 msを達成 — 生のSTRINGより80倍高速、JSONBより12倍高速。
- **シャーディング付きのDOC Mapが効果的。** ドキュメントマップのシャーディングにより、非マテリアライズパスのクエリ時間が2.5秒から148 msに短縮されました。
- **JSONBとSTRINGはメモリを大量消費。** VARIANTモードの1 MiBに対し、32–48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルではStorage Format V3から開始する。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、幅の広いJSONワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが高くなります。
- **Schema Templateを介して早期に主要パスを固定する。** Schema Templateがないと、システムは型を自動的に推測します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格し、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状から調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI訓練、コネクテッドビークル、ユーザータグシステムなどのワークロードが異常に大きなSubcolumnizationスケールと多数のパスレベルインデックスを必要とする場合のみ、シナリオごとに調整してください。初日からの過度な設定（非常に大きな`variant_max_subcolumns_count`、不要な場合のDOCモード有効化）は、利益の証拠なしに複雑さを追加します。

### クエリフェーズ

- **非常に幅の広い`VARIANT`カラムの主要クエリパターンとして`SELECT *`を使用しない。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は常にサブパスをCASTする。** 型推測は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているが整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視する。** サブカラムの増大はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ遅延を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視する。** 同じパス上での頻繁な型競合は、JSONB昇格とインデックス喪失を避けるためにSchema Templateを介してそのパスをロックすべきことを示します。

## クイック検証

テーブルを作成した後、すべてが正常に動作することを確認するために次の最小限のシーケンスを使用してください：

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
