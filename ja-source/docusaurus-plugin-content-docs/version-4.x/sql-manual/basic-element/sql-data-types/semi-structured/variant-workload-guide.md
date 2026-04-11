---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT` は半構造化JSONを格納し、頻繁に使用されるパスでSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に使用してください。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`または静的カラムを使用すべきか？
- JSONが非常に幅広い場合、デフォルトの動作、sparse columns、またはDOCモードから開始すべきか？
- どの設定をデフォルトのままにして、どの設定を最初に変更すべきか？

すでに`VARIANT`を使用したいことが分かっており、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)に進んでください。最小の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)に進んでください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保持しながら、DorisはSubcolumnizationを頻繁に使用されるパスに適用できます。これにより、一般的なフィルタ、集計、パスレベルのインデックスが、ドキュメントスキーマ全体を事前に固定することなく効果的に動作します。非常に幅広いJSONでは、ストレージレイヤの最適化によりSubcolumnizationがはるかに大きなパス数でも実用的になります。
:::

## VARIANTが適している場合

以下の条件の大部分が当てはまる場合、`VARIANT`は通常適しています：

- 入力がJSONまたは時間とともにフィールドが進化する別の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- 列指向分析のパフォーマンスを諦めることなくスキーマの柔軟性が必要。
- 一部のパスにはインデックスが必要で、他の多くのパスは動的のままにできる。

以下の条件が優勢な場合は静的カラムを選択してください：

- スキーマが安定しており事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパスによる分析ではなく、生のJSONのアーカイブである。

## 最初の4つの質問

設定に触れる前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスはあるか？

クエリが同じJSONパスを繰り返し使用する場合、Dorisはそれらのパスに対してSubcolumnizationを継続的に適用できます。これが`VARIANT`が最も役立つ場面です。

### 2. いくつかのパスに固定型または安定したインデックスが必要か？

はいの場合、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールド用であり、ドキュメント全体を記述するためのものではありません。

### 3. 本当に幅広いJSONになっているか？

パス数が継続的に増加し、メタデータ圧迫、コンパクション圧迫、または顕著なクエリオーバーヘッドを作り始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、何がより重要か：ホットパス分析か全ドキュメント返却か？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集計、インデックス作成の場合は、sparse columnsに向かってください。
- 主な価値が取り込み効率または全ドキュメントの返却の場合は、DOCモードに向かってください。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列指向サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`カラムの宣言。型付け、インデックス化、予測可能性を維持する必要があるキービジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が継続的に増加し、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストが増加し始めた場合、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールド分割がある場合、sparse columnsはホットパスをSubcolumnizationに保持しながら、コールド（ロングテール）パスを共有sparse storageにプッシュします。Sparse storageは読み取りの並列性向上のため複数の物理カラムでのシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立した列指向サブカラムとして残り、数千のロングテールパスは共有sparse storageに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のsparse columnが読み取りボトルネックになる可能性があります。Sparse shardingはロングテールパスをハッシュによって複数の物理カラム（`variant_sparse_hash_shard_count`）に分散させ、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延させ、さらに元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加のストレージコストで高速な取り込みと効率的な全ドキュメント返却を提供します。Subcolumnizationは後でコンパクション中に発生します。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図のように、書き込み中はJSONがそのままDoc Storeに保存され、高速な取り込みが可能になります。サブカラムは後でコンパクション中に抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は物質化されたサブカラムから完全な列指向速度で読み取り、全ドキュメントクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOCモードは、クエリされたパスが物質化されているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**：クエリされたパスが既にサブカラムに抽出されています（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルトの`VARIANT`と同じ完全な列指向速度で読み取ります。
- **DOC Map**：クエリされたパスがまだ物質化されていません。クエリは値を見つけるためにdoc map全体をスキャンするフォールバックを行います—幅広いJSONでは著しく遅くなります。
- **DOC Map (Sharded)**：同じフォールバックですが、`variant_doc_hash_shard_count`によってdoc mapが複数の物理カラムに分散され、並列スキャンとはるかに高速な復旧が可能になります。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。すべての`VARIANT`テーブル、特に幅広いJSONに推奨されます。数千のサブカラムが存在する場合にメタデータボトルネックを排除するためです。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

以下の表を使用して開始点を選択し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパス少ない） | Sparse + V3 | `variant_max_subcolumns_count`, `variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（取り込み重視または全ドキュメント返却） | DOCモード + V3 | `variant_enable_doc_mode`, `variant_doc_materialization_min_rows` |
| **D** | 注文/決済/デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリが少数の馴染みのあるパスを繰り返し使用するイベントログまたは監査ペイロード。

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
ワークロードがsparse columnsやDOC modeを正当化するのに十分広いかどうかまだ確信が持てず、価値の大部分がいくつかの共通パスでのフィルタリング、集計、グループ化から得られる場合に使用します。

注意点:
- パスの増加が既に負荷を引き起こしていない限り、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが広くない場合、sparse columnsやDOC modeを有効にすることは利益なしに複雑さを追加します。

### Sparse Mode

ペイロードが広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columnsを選択します。

典型的な例: 数千のオプション属性を持つがごく一部だけが定期的にクエリされる広告、テレメトリ、またはプロファイルJSON。

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
総キー数が非常に多いが、主要なワークロードがパスベースのフィルタリング、集約、インデックス化である場合に使用します。

注意点:
- ホットパス分析がボトルネックの場合、まずDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これは既にほとんどのワークロードで自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を推奨します。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すこと、またはパスベース分析の最適化よりも取り込みオーバーヘッドの最小化が重要な場合にDOCモードを選択します。

典型的な例: モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合:

- Subcolumnizationスケールが極めて大規模になる場合（10,000パスに近づく）、ハードウェア要件が急速に上昇します。この規模ではDOCモードがより安定した選択です。
- コンパクションメモリは、デフォルトのイーガーSubcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5～10倍改善できます。
- クエリが`VARIANT`値全体（`SELECT variant_col`）を読み取る場合、DOCモードは数千のサブカラムから文書を再構築することを回避し、桁違いのスピードアップを実現します。

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
ingestion のスループットが最優先である場合、ワークロードで完全な JSON ドキュメントを頻繁に取得する必要がある場合、または `SELECT variant_col` で非常に幅広いカラムを読み取ることが多い場合に使用してください。

注意点:
- DOC モードは、すべての幅広い JSON ワークロードに対するデフォルトの解決策ではありません。ホットパス分析が支配的である場合、通常はスパースカラムの方が適しています。
- DOC モードとスパースカラムは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は Schema Template を選択してください。

典型的な例: 注文、支払い、またはデバイスペイロードで、いくつかのビジネスクリティカルなパスが型付けされ検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。必要に応じてSchema Templateとsparse columnsまたはデフォルトの`VARIANT`を組み合わせます。

注意点：
- JSONスキーマ全体を静的テンプレートに変換しないでください。これでは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的なままにします。

## パフォーマンス

以下のチャートは、10Kパスのwide-columnデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

主なポイント：

- **Materializedサブカラムが勝利。** DefaultとDOC Materializedの両方が約76 ms を達成 — 生のSTRINGより80倍高速、JSONBより12倍高速。
- **Shardingを伴うDOC Mapが有効。** doc mapをshardingすることで、非materializedパスのクエリ時間が2.5秒から148 msに短縮されます。
- **JSONBとSTRINGはメモリ消費が大きい。** VARIANTモードの1 MiBに対し、32–48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルにはStorage Format V3から始める。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、広いJSONワークロードでファイルオープンが遅く、メモリオーバーヘッドが高くなります。
- **Schema Templateで早期に主要パスを固定する。** Schema Templateがないと、システムが型を自動推論します。同じパスがバッチ間で型を変更する（例：整数から文字列）と、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状に応じて調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI学習、コネクテッドカー、ユーザータグシステムなどで異常に大きなSubcolumnizationスケールと多数のパスレベルインデックスが必要な場合のみ、シナリオに応じて調整します。初日から過度に設定する（非常に大きな`variant_max_subcolumns_count`、不要な場合のDOCモード有効化）と、利益の証拠もなく複雑さが増します。

### クエリフェーズ

- **非常に広い`VARIANT`カラムのメインクエリパターンとして`SELECT *`を使用しない。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構成する必要があり、`SELECT v['path']`のようにパスを指定するよりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスをCASTする。** 型推論が期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違う可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視する。** サブカラムの増加によりマージコストが増加します。Compaction Scoreが上昇し続ける場合は、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更される場合、ホットパスがsparseストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateでクリティカルなパスをロックしてください。
- **型の競合を監視する。** 同じパスでの頻繁な型競合は、そのパスをSchema Template経由でロックしてJSONB昇格とインデックス損失を回避すべきことを示しています。

## クイック検証

テーブル作成後、以下の最小シーケンスを使用してすべてが動作することを確認してください：

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
