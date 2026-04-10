---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する判断ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際にお使いください。次のような疑問に答えるのに役立ちます：

- このワークロードは`VARIANT`または静的列を使用すべきか？
- JSONが非常に幅広い場合、デフォルトの動作、スパース列、またはDOCモードから開始すべきか？
- どの設定をデフォルトのままにして、どれを最初に変更すべきか？

すでに`VARIANT`を使用することが決まっており、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)をご覧ください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)をご覧ください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を維持しながら、Dorisは頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、文書スキーマ全体を事前に固定することなく、一般的なフィルタ、集約、パスレベルのインデックスが効率的に動作します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに多くのパス数でSubcolumnizationが実用的になります。
:::

## VARIANTが適用される場面

`VARIANT`は通常、以下の条件の大部分が当てはまる場合に適しています：

- 入力がJSONまたは時間の経過とともにフィールドが変化するその他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- 列志向分析のパフォーマンスを諦めることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的のままでよい。

以下の条件が支配的な場合は静的列を選択してください：

- スキーマが安定しており、事前に分かっている。
- 中核となるフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される。
- 主要な要件が生のJSONをアーカイブすることであり、パス別に分析することではない。

## 最初の4つの質問

設定に触れる前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスはあるか？

クエリが同じJSONパスに繰り返し触れる場合、Dorisはそれらのパスに対してSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も役立つ場面です。

### 2. 一部のパスに固定型や安定したインデックスが必要か？

必要な場合は、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールド用であり、文書全体を記述するためのものではありません。

### 3. 実際に幅広いJSONになっているか？

パス数が増加し続け、メタデータの負荷、コンパクションの負荷、または目に見えるクエリのオーバーヘッドを生み出し始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、ホットパス分析と文書全体の返却のどちらがより重要か？

- 主な価値がホットフィールドのパスベースのフィルタリング、集約、インデックスにある場合は、スパース列に向かってください。
- 主な価値がインジェスト効率または文書全体の返却にある場合は、DOCモードに向かってください。

## 主要な概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)をご覧ください。

**Subcolumnization。** データが`VARIANT`列に書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列指向のサブ列として抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** `VARIANT`列で選択されたパスを安定した型に固定する宣言。型付け、インデックス可能、予測可能でなければならない主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増大を始めた場合、幅広いJSONの問題があります。

**スパース列。** 幅広いJSONに明確なホット/コールドの分割がある場合、スパース列はホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。スパースストレージは、より良い読み取り並列性のために複数の物理列にわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page`など）は完全な分析速度で独立した列指向サブ列として残り、数千のロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**スパースシャーディング。** ロングテールパス数が非常に多い場合、単一のスパース列が読み取りのボトルネックになることがあります。スパースシャーディングは、ロングテールパスをハッシュによって複数の物理列（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延させ、さらに元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加ストレージのコストで高速インジェストと効率的な文書全体の返却が可能になります。Subcolumnizationはコンパクション中に後で発生します。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図のように、書き込み中にJSONは高速インジェストのためにDoc Storeにそのまま保存されます。サブ列はコンパクション中に後で抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全な列指向速度で実体化されたサブ列から読み取り、文書全体のクエリ（`SELECT v`）はサブ列から再構築せずにDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスが実体化されているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスが既にサブ列に抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトの`VARIANT`と同じ完全な列指向速度で読み取ります。
- **DOC Map**: クエリされたパスがまだ実体化されていない。クエリは値を見つけるためにdoc map全体をスキャンすることにフォールバックします — 幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**: 同じフォールバック方式ですが、`variant_doc_hash_shard_count`でdoc mapが複数の物理列に分散され、並列スキャンとはるかに高速な回復が可能になります。

**Storage Format V3。** 列メタデータをセグメントフッターから分離します。数千のサブ列が存在する場合のメタデータボトルネックを排除するため、すべての`VARIANT`テーブル、特に幅広いJSONに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために以下の表を使用し、該当するセクションをお読みください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトのまま |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパスが少ない） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先または文書全体の返却） | DOC mode + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみ定義 |

### デフォルトモード

これは新しい`VARIANT`ワークロードの大部分にとって最も安全な開始点です。

典型的な例：クエリが少数の既知のパスに繰り返し触れるイベントログや監査ペイロード。

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
ワークロードがsparse columnsやDOC modeを正当化するのに十分な幅があるかどうかまだ確信が持てず、ほとんどの価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点：
- パスの増加が既に負荷を引き起こしている場合を除き、早期に`variant_max_subcolumns_count`を上げないでください。
- JSONが幅広でない場合、sparse columnsやDOC modeを有効にすると利益なしに複雑性が増します。

### Sparseモード

ペイロードが幅広であるが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columnsを選択してください。

典型例：数千のオプション属性を持つが定期的にクエリされるのは数十のみの広告、テレメトリ、またはプロファイルJSON。

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
- ホットパス分析がボトルネックの場合、最初にDOCモードに飛び付かないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードで自動Subcolumnizationの適切な開始点です。事実上すべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大きな抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を推奨します。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや、パスベース分析の最適化よりも取り込みオーバーヘッドの最小化が重要な場合は、DOCモードを選択してください。

典型的な例: モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが役立つ場合:

- Subcolumnizationスケールが極めて大きくなる場合（10,000パスに近づく場合）、ハードウェア要件が急速に上昇します。DOCモードはこのスケールでより安定した選択です。
- コンパクションメモリは、デフォルトの積極的なSubcolumnizationと比較して約3分の2削減できます。
- スパースワイドカラム取り込みワークロードでは、スループットが約5〜10倍改善できます。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムから文書を再構築することを回避し、桁違いの高速化を実現します。

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
ingest スループットが最優先事項である場合、ワークロードが完全なJSON文書を頻繁に必要とする場合、または非常に幅広いカラムが`SELECT variant_col`でよく読み取られる場合に使用してください。

注意点：
- DOCモードは、すべての幅広いJSONワークロードのデフォルトの解決策ではありません。ホットパス分析が支配的な場合、sparse columnsの方が通常適しています。
- DOCモードとsparse columnsは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は、Schema Templateを選択してください。

典型的な例：注文、支払い、またはデバイスペイロードで、いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスがより厳密な型指定やパスレベルインデックス戦略を必要とする場合に使用します。適切な場合は、Schema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON schema全体を静的テンプレートに変換しないでください。それでは`VARIANT`の意味がなくなります。
- Schema Templateは重要なパスのみをカバーし、残りは動的なままにしておいてください。

## パフォーマンス

以下のチャートは、10K-pathワイドカラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）における単一パス抽出時間を比較しています。

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

- **マテリアライズドサブカラムが勝利。** DefaultとDOC Materializedの両方が約76msを実現 — 生のSTRINGより80倍高速、JSONBより12倍高速。
- **シャーディングありのDOC Mapが効果的。** doc mapをシャーディングすることで、非マテリアライズドパスのクエリ時間が2.5秒から148msに短縮。
- **JSONBとSTRINGはメモリ消費が大きい。** VARIANTモードの1 MiBに対し、32〜48 GiBのピークメモリを消費。

## ベストプラクティス

### インポート段階

- **新しい`VARIANT`テーブルにはStorage Format V3から開始する。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、ワイドJSONワークロードはファイルオープンの遅延と高いメモリオーバーヘッドの問題を抱えます。
- **Schema Templateで重要なパスを早期に固定する。** Schema Templateがないと、システムは型を自動的に推論します。同じパスがバッチ間で型を変更した場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整する。** ほとんどのワークロードではデフォルト設定で十分です。AI訓練、コネクテッドカー、ユーザータグシステムなどのワークロードが異常に大きなSubcolumnizationスケールと多くのパスレベルインデックスを必要とする場合のみ、シナリオ別に調整してください。初日から過度に設定する（非常に大きな`variant_max_subcolumns_count`、不要な場合のDOCモード有効化）ことは、効果の証拠なしに複雑さを増すだけです。

### クエリ段階

- **非常にワイドな`VARIANT`カラムに対するメインクエリパターンとして`SELECT *`を使用しない。** DOCモードがないと、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようにパスを指定するよりもはるかに低速です。
- **クエリが型に依存する場合は、常にサブパスをCASTする。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違っている可能性があります。

### 運用段階

- **コンパクション圧力を監視する。** サブカラムの増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更されると、ホットパスがスパースストレージに押し込まれ、突然のクエリ性能低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視する。** 同じパス上での頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにSchema Templateでそのパスをロックすべきことを示しています。

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
