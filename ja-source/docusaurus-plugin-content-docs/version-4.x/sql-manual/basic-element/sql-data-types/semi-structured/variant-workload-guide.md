---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを適用します。

このガイドは、新しい`VARIANT`ワークロードのモデル化方法を決定する際に使用してください。以下のような質問への回答に役立ちます：

- このワークロードは`VARIANT`を使用するべきか、静的カラムを使用するべきか？
- JSONが非常に幅広い場合、デフォルト動作、sparse columns、DOCモードのどれから始めるべきか？
- どの設定をデフォルトのままにして、どれを最初に変更すべきか？

`VARIANT`を使用することが既に決まっており、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。実行可能な最小のインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisが頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、一般的なフィルタリング、集約、パスレベルのインデックスが、ドキュメントスキーマ全体を事前に固定することなく適切に動作します。非常に幅広いJSONでは、ストレージレイヤーの最適化により、はるかに大きなパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適合する場合

`VARIANT`は通常、以下の条件の大部分が当てはまる場合に適しています：

- 入力がJSONまたは時間とともにフィールドが進化するその他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- カラム分析パフォーマンスを犠牲にすることなく、スキーマの柔軟性を求めている。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が支配的な場合は静的カラムを優先してください：

- スキーマが安定しており、事前に既知である。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別の分析ではなく、生JSONのアーカイブである。

## 最初の4つの質問

設定に触れる前に、これら4つの質問に答えてください。

### 1. 明確なホットパスは存在するか？

クエリが同じJSONパスに繰り返し触れる場合、DorisはそれらのパスにSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も役立つ領域です。

### 2. 少数のパスが固定型や安定したインデックスを必要とするか？

必要な場合は、それらのパスにのみSchema Templateを使用してください。これはドキュメント全体を記述するためではなく、少数のビジネスクリティカルなフィールドのためのものです。

### 3. これは本当に幅広いJSONになっているか？

パス数が増え続け、メタデータの負荷、コンパクション負荷、または顕著なクエリオーバーヘッドを生み出し始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、ホットパス分析とドキュメント全体の返却のどちらがより重要か？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集約、インデックスにある場合は、sparse columnsに傾く。
- 主な価値が取り込み効率またはドキュメント全体の返却にある場合は、DOCモードに傾く。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** `VARIANT`カラムにデータが書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のために独立したカラム型サブカラムとしてホットパスを抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`カラムでの宣言。型付け、インデックス可能、予測可能であることが必要なキービジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始した場合、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールドの分離がある場合、sparse columnsはホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有sparse storageにプッシュします。Sparse storageは、より良い読み取り並列性のために複数の物理カラムにわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして残り、一方で何千ものロングテールパスは共有sparse storageに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のsparse columnが読み取りボトルネックになる可能性があります。Sparse shardingは、複数の物理カラム（`variant_sparse_hash_shard_count`）にハッシュによってロングテールパスを分散させるため、並列にスキャンできます。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時のSubcolumnizationを遅延させ、さらに元のJSONをマップ形式の保存フィールド（**doc map**）として格納します。これにより、追加のストレージコストで高速な取り込みと効率的なドキュメント全体の返却を実現します。Subcolumnizationは後でコンパクション中に行われます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み中はJSONが高速取り込みのためにDoc Storeにそのまま保存されます。サブカラムは後でコンパクション中に抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全なカラム速度で実体化されたサブカラムから読み取り、一方でドキュメント全体のクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスが実体化されているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**：クエリされたパスがすでにサブカラムに抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトVARIANTと同じく、完全なカラム速度で読み取り。
- **DOC Map**：クエリされたパスがまだ実体化されていない。クエリは値を見つけるためにdoc map全体のスキャンにフォールバック — 幅広いJSONでは大幅に遅くなる。
- **DOC Map (Sharded)**：同じフォールバック、ただし`variant_doc_hash_shard_count`でdoc mapが複数の物理カラムに分散され、並列スキャンとはるかに高速な回復を可能にする。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。任意の`VARIANT`テーブル、特に幅広いJSONに推奨されます。何千ものサブカラムが存在する場合のメタデータボトルネックを排除するためです。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選択するために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広く、ホットパス少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（取り込み優先またはドキュメント全体返却） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型例：クエリが少数の馴染みのあるパスに繰り返し触れるイベントログまたは監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化するほど十分に幅広いかどうかまだ確信が持てず、価値の大部分がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用します。

注意点：
- パスの増加が既に負荷を引き起こしている場合以外は、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると利益なしに複雑性が増します。

### Sparseモード

ペイロードが幅広いが、ほとんどのクエリが依然として小さなホットパスのセットに焦点を当てている場合はsparse columnsを選択します。

典型的な例：数千のオプション属性を持つが、定期的にクエリされるのは数十のみの広告、テレメトリ、またはプロファイルJSON。

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
総キー数が非常に大きいが、主要なワークロードがパスベースのフィルタリング、集約、インデックス化である場合に使用してください。

注意点：
- ホットパス分析がボトルネックの場合は、まずDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードで自動Subcolumnizationの適切な開始点です。すべてのパスが効果的にSubcolumnizationを通過するほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を選択してください。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや取り込みオーバーヘッドの最小化が、パスベース分析の最適化よりも重要な場合にDOCモードを選択してください。

典型例：モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合：

- Subcolumnizationスケールが極めて大規模になる（10,000パスに近づく）場合、ハードウェア要件が急激に上昇します。この規模では、DOCモードがより安定した選択肢です。
- コンパクションメモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- 疎な広カラム取り込みワークロードでは、スループットが約5～10倍向上する可能性があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムから文書を再構築することを避け、桁違いの高速化を実現します。

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
ingest のスループットが最優先である場合、ワークロードが頻繁に完全な JSON ドキュメントを必要とする場合、または非常に幅の広いカラムが `SELECT variant_col` で頻繁に読み取られる場合に使用します。

注意点：
- DOC モードは、すべての幅の広い JSON ワークロードに対するデフォルトの回答ではありません。ホットパス分析が支配的である場合、通常はスパースカラムの方が適しています。
- DOC モードとスパースカラムは相互に排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスが安定した型、安定した動作、またはパス固有のインデックスを必要とする場合は Schema Template を選択します。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合は、Schema Templateをスパース列またはデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON スキーマ全体を静的テンプレートに変換しないでください。これでは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的なままにしておく必要があります。

## パフォーマンス

以下のチャートは、10K パス幅列データセット（200K 行、1つのキーを抽出、16 CPU、3回実行の中央値）における単一パス抽出時間を比較したものです。

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

主な要点：

- **Materializedサブカラムが優勝。** DefaultとDOC Materializedの両方が約76 msを実現 — 生のSTRINGより80倍高速、JSONBより12倍高速。
- **DOC Mapでのシャーディングが効果的。** doc mapをシャーディングすることで、非materializedパスのクエリ時間を2.5秒から148 msに短縮。
- **JSONBとSTRINGはメモリ集約的。** VARIANTモードの1 MiBに対し、32～48 GiBのピークメモリを消費。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルではStorage Format V3から開始。** V3は列メタデータをセグメントフッターから分離します。これがないと、幅広いJSONワークロードでファイルオープンが遅く、高いメモリオーバーヘッドが発生します。
- **Schema Templateを使用して主要パスを早期に固定。** Schema Templateがないと、システムは型を自動的に推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整。** ほとんどのワークロードでは、デフォルトで十分です。AI訓練、コネクテッドカー、ユーザータグシステムなどのワークロードで異常に大きなSubcolumnizationスケールと多くのパスレベルインデックスが必要な場合のみ、シナリオに応じて調整してください。初日から過度に設定する（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）と、利益の証拠なしに複雑性が増します。

### クエリフェーズ

- **非常に幅広い`VARIANT`列のメインクエリパターンとして`SELECT *`を使用しない。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は常にサブパスをCAST。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているが整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視。** サブカラムの成長はマージコストを増加させます。Compaction Scoreが上昇し続ける場合は、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるために、そのパスをSchema Templateでロックすべきであることを示しています。

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
- [Variantデータのインポート](../../../../data-operate/import/complex-types/variant)
- [ストレージフォーマット V3](../../../../table-design/storage-format)
- [SEARCH関数](../../../../ai/text-search/search-function)
