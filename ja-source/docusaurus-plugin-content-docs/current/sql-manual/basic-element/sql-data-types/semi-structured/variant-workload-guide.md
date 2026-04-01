---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスでSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に使用してください。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが非常に幅広い場合、デフォルト動作、スパースカラム、またはDOCモードから始めるべきか？
- どの設定をデフォルトのままにして、どの設定を最初に変更すべきか？

すでに`VARIANT`を使用することが決まっていて、構文や型のルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANT を選ぶ理由
`VARIANT`はJSONの柔軟性を保持しますが、Dorisは頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、一般的なフィルター、集約、およびパスレベルのインデックスは、ドキュメントスキーマ全体を事前に固定することなく適切に動作します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに大きなパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適合する場合

`VARIANT`は通常、以下の条件の大部分が当てはまる場合に適しています：

- 入力がJSONまたは時間とともにフィールドが進化するその他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- カラム型分析パフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的のままでよい。

以下の条件が支配的な場合は静的カラムを優先してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別分析ではなく、生JSONのアーカイブである。

## 最初の4つの質問

設定に触れる前に、これら4つの質問に答えてください。

### 1. 明確なホットパスがありますか？

クエリが同じJSONパスを繰り返しアクセスする場合、Dorisはそれらのパスに対してSubcolumnizationを継続して適用できます。これが`VARIANT`が最も役立つ場面です。

### 2. 固定型や安定したインデックスが必要なパスが少数ありますか？

はいの場合、それらのパスのみにSchema Templateを使用してください。これは、ドキュメント全体を記述するためではなく、少数のビジネスクリティカルなフィールドのためのものです。

### 3. これは本当に幅広いJSONになっていますか？

パス数が増加し続け、メタデータの負荷、コンパクション負荷、または顕著なクエリオーバーヘッドを発生させ始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONにおいて、ホットパス分析と全ドキュメント返却のどちらがより重要ですか？

- 主な価値がホットフィールドでのパスベースフィルタリング、集約、インデックス化にある場合は、スパースカラムに傾いてください。
- 主な価値がインジェスト効率または全ドキュメントの返却にある場合は、DOCモードに傾いてください。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています。実装詳細については[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** `VARIANT`カラムにデータが書き込まれると、DorisはJSONパスを自動的に検出し、効率的な分析のために独立したカラム型サブカラムとしてホットパスを抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択したパスを安定した型に固定する`VARIANT`カラムの宣言です。型付け、インデックス化、予測可能性が必要な主要ビジネスフィールドに使用してください。可能なすべてのパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストを増加させ始めた場合、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールド分割がある場合、スパースカラムはホットパスをSubcolumnizationに保持しながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。スパースストレージは、より良い読み取り並列性のために複数の物理カラムにわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度で独立したカラム型サブカラムとして残り、数千のロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のスパースカラムが読み取りボトルネックになる可能性があります。スパースシャーディングは、ロングテールパスをハッシュによって複数の物理カラム（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOC mode。** 書き込み時にSubcolumnizationを遅延し、加えて元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加ストレージのコストで高速インジェストと効率的な全ドキュメント返却が可能になります。Subcolumnizationは依然としてコンパクション中に後で発生します。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み中はJSONが高速インジェストのためにDoc Storeにそのまま保持されます。サブカラムはコンパクション中に後で抽出されます。読み取り時、パスベースクエリ（例：`SELECT v['user_id']`）は完全なカラム速度でマテリアライズドサブカラムから読み取り、全ドキュメントクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスがマテリアライズされているかどうかに応じて、3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスがすでにサブカラムに抽出されています（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトVARIANTと同じ完全なカラム速度で読み取ります。
- **DOC Map**: クエリされたパスがまだマテリアライズされていません。クエリは値を見つけるためにdoc map全体をスキャンすることにフォールバックします — 幅広いJSONでは著しく低速です。
- **DOC Map (Sharded)**: 同じフォールバックですが、`variant_doc_hash_shard_count`でdoc mapが複数の物理カラムに分散され、並列スキャンとはるかに高速な回復が可能になります。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。特に幅広いJSONの場合、数千のサブカラムが存在する際のメタデータボトルネックを排除するため、すべての`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパスが少ない） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先または全ドキュメント返却） | DOC mode + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（主要パスに安定した型が必要） | Schema Template + A または B | 主要パスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型例：クエリが少数の馴染みのあるパスを繰り返しアクセするイベントログや監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化するほど十分に広いかどうかまだ確信が持てず、ほとんどの価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用します。

注意点：
- パスの増加がすでに負荷を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に引き上げないでください。
- JSONが広くない場合、sparse columnsやDOCモードを有効にすると、利益なしに複雑性が増します。

### Sparseモード

ペイロードは広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columnsを選択します。

典型的な例：数千のオプション属性を持つが、定期的にクエリされるのは数十程度の広告、テレメトリ、またはプロファイルJSON。

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
総キー数が非常に多いが、主要なワークロードが依然としてパスベースのフィルタリング、集約、およびインデックス化である場合に使用します。

注意点:
- ホットパス分析がボトルネックの場合、最初にDOCモードにジャンプしないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これは既にほとんどのワークロードで自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を選択してください。

### DOC Mode {#doc-mode-template}

JSONドキュメント全体を返すことや、取り込みオーバーヘッドの最小化が、パスベース分析の最適化よりも重要な場合にDOCモードを選択します。

典型例: モデルレスポンス、トレーススナップショット、または完全なペイロードとして頻繁に返されるアーカイブされたJSONドキュメント。

DOCモードが有効な場合:

- Subcolumnizationスケールが極端に大きくなる場合（10,000パスに近づく場合）、ハードウェア要件が急速に増加します。この規模ではDOCモードがより安定した選択肢です。
- コンパクションメモリはデフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースワイドカラム取り込みワークロードでは、スループットが約5〜10倍向上することがあります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムからドキュメントを再構築することを回避し、桁違いの高速化を実現します。

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
ingest スループットが最優先の場合、ワークロードで完全なJSONドキュメントを頻繁に取得する必要がある場合、または`SELECT variant_col`で非常に幅の広いカラムを頻繁に読み取る場合に使用してください。

注意点:
- DOCモードは、すべての幅の広いJSONワークロードに対するデフォルトの答えではありません。ホットパス分析が主な場合、通常はスパースカラムの方が適しています。
- DOCモードとスパースカラムは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択してください。

典型的な例: 注文、支払い、またはデバイスペイロードで、いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数のみで、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。必要に応じてSchema Templateをスパース列やデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON スキーマ全体を静的テンプレートに変換しないでください。それでは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的に保つべきです。

## パフォーマンス

以下のチャートは、10K パス幅広カラムデータセット（200K 行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

- **マテリアライズされたサブカラムが勝利。** DefaultとDOC Materializedの両方が約76 msを実現 — raw STRINGより80倍高速、JSONBより12倍高速。
- **シャーディングされたDOC Mapは効果的。** doc mapをシャーディングすることで、マテリアライズされていないパスのクエリ時間を2.5秒から148 msに短縮。
- **JSONBとSTRINGはメモリを大量消費。** VARIANTモードの1 MiBに対し、32-48 GiBのピークメモリを消費。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルにはStorage Format V3から開始。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、幅広いJSONワークロードでファイル開始が遅く、メモリオーバーヘッドが大きくなります。
- **Schema Templateで主要パスを早期に固定。** Schema Templateがないと、システムが自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整。** ほとんどのワークロードでは、デフォルトで十分です。AI トレーニング、コネクテッドカー、ユーザータグシステムなど、異常に大きなSubcolumnizationスケールと多数のパスレベルインデックスが必要なワークロードの場合のみ、シナリオに応じて調整してください。初日から過度に設定すること（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）は、利益の証拠なしに複雑さを追加します。

### クエリフェーズ

- **非常に幅広い`VARIANT`カラムに対して`SELECT *`をメインのクエリパターンとして使用しない。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようにパスを指定するよりもはるかに低速です。
- **クエリが型に依存する場合は常にサブパスをCAST。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視。** サブカラムの増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、クエリの突然の減速を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型の競合を監視。** 同じパスでの頻繁な型競合は、JSONBへの昇格とインデックスの損失を避けるため、Schema Templateでパスをロックすべきであることを示しています。

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
