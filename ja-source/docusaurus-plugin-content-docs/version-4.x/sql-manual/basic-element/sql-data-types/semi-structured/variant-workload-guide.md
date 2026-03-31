---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

新しい`VARIANT`ワークロードをモデル化する方法を決定する際に、このガイドを使用してください。このガイドは以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、静的列を使用すべきか？
- JSONが非常にワイドな場合、デフォルトの動作、sparse columns、またはDOCモードから始めるべきか？
- どの設定をデフォルトのままにして、どの設定を最初に変更すべきか？

すでに`VARIANT`を使用することが決まっていて、構文や型ルールだけが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選択する理由
`VARIANT`はJSONの柔軟性を保持しながら、DorisはSubcolumnizationを頻繁に使用されるパスに適用できます。これにより、文書スキーマ全体を事前に固定することなく、一般的なフィルタ、集約、パスレベルインデックスが効率的に動作します。非常にワイドなJSONでは、ストレージ層の最適化により、はるかに多いパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

`VARIANT`は通常、以下のほとんどが当てはまる場合に適しています：

- 入力がJSONまたは時間の経過とともにフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- 列指向アナリティクス性能を犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままにしておける。

以下の条件が支配的な場合は、静的列を選択してください：

- スキーマが安定していて事前に分かっている。
- コアフィールドがjoinキー、ソートキー、または厳密に制御された型付き列として定期的に使用される。
- 主な要件がパスによる分析ではなく、生JSONのアーカイブである。

## 最初に4つの質問

設定を変更する前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスがありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、Dorisはこれらのパスにsubcolumnizationを適用し続けることができます。これは`VARIANT`が最も効果を発揮する場面です。

### 2. 少数のパスで固定型または安定したインデックスが必要ですか？

必要な場合は、これらのパスのみにSchema Templateを使用してください。これは文書全体を記述するためではなく、少数のビジネスクリティカルなフィールド向けのものです。

### 3. これは本当にワイドJSONになりつつありますか？

パス数が継続的に増加し、メタデータ圧迫、compaction圧迫、または顕著なクエリオーバーヘッドを生成し始めた場合、ワイドJSONの問題があります。

### 4. ワイドJSONの場合、どちらがより重要ですか：ホットパスアナリティクスか文書全体の返却か？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集約、インデックスである場合、sparse columnsに傾倒してください。
- 主な価値が取り込み効率または文書全体の返却である場合、DOCモードに傾倒してください。

## 主要概念

以下のストレージモードを読む前に、これらの用語を理解してください。それぞれ2-3行で説明されています；実装詳細については[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`列に書き込まれると、DorisはJSONパスを自動的に発見し、ホットパスを独立した列指向サブ列として抽出して効率的なアナリティクスを実現します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`列上の宣言。型付け、インデックス可能、予測可能な状態を保持する必要がある主要なビジネスフィールドに使用します。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 個別パスの数が継続的に増加し、メタデータサイズ、書き込みコスト、compactionコスト、またはクエリコストの増大を開始した場合、ワイドJSONの問題があります。

**Sparse columns。** ワイドJSONに明確なホット/コールド分離がある場合、sparse columnsはホットパスをSubcolumnizationに保持しながら、コールド（ロングテール）パスを共有sparseストレージにプッシュします。Sparseストレージは、より良い読み取り並列性のために複数の物理列にわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page`など）は完全なアナリティクス速度を持つ独立した列指向サブ列として残り、何千ものロングテールパスは共有sparseストレージに収束されます。閾値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のsparse columnが読み取りボトルネックになることがあります。Sparse shardingは、複数の物理列（`variant_sparse_hash_shard_count`）にわたってハッシュによりロングテールパスを分散し、並列スキャンを可能にします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延し、さらに元のJSONをmap形式のstored field（**doc map**）として格納します。これにより、追加ストレージのコストで高速取り込みと効率的な文書全体返却を実現します。Subcolumnizationは後でcompaction中に実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図のように、書き込み時にJSONはDoc Storeにそのまま保存され、高速取り込みを実現します。サブ列は後でcompaction時に抽出されます。読み取り時、パスベースクエリ（例：`SELECT v['user_id']`）は物質化されたサブ列から完全な列指向速度で読み取り、文書全体クエリ（`SELECT v`）はサブ列から再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスが物質化されているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスがすでにサブ列に抽出されている場合（compaction後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルト`VARIANT`と同じ完全な列指向速度で読み取ります。
- **DOC Map**: クエリされたパスがまだ物質化されていない場合。クエリは値を見つけるために文書map全体をスキャンする必要があります — ワイドJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**: 同じフォールバックですが、`variant_doc_hash_shard_count`により文書mapが複数の物理列に分散され、並列スキャンとはるかに高速な回復が可能になります。

**Storage Format V3。** 列メタデータをセグメントフッターから分離します。何千ものサブ列が存在する場合にメタデータボトルネックを排除するため、すべての`VARIANT`テーブル、特にワイドJSONに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選択するには以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを保持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（ワイド、ホットパス少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（取り込み優先または文書全体返却） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（主要パスに安定した型が必要） | Schema Template + AまたはB | 主要パスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

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
ワークロードが sparse columns や DOC mode を正当化するのに十分な幅があるかどうかまだ確信が持てず、フィルタリング、集約、およびいくつかの共通パスでのグループ化からまだ最も価値が得られる場合に使用してください。

注意点：
- パス増加がすでに負荷を引き起こしている場合を除き、`variant_max_subcolumns_count` を早期に上げないでください。
- JSON が幅広くない場合、sparse columns や DOC mode を有効にすると利益なしに複雑さが追加されます。

### Sparse Mode

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合に sparse columns を選択してください。

典型的な例：数千のオプション属性を持つが、定期的にクエリされるのは数十のみである広告、テレメトリ、またはプロファイル JSON。

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
- ホットパス分析がボトルネックの場合、まずDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードで自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を推奨します。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや取り込みオーバーヘッドの最小化が、パス ベース分析の最適化よりも重要である場合にDOCモードを選択してください。

典型的な例：モデル レスポンス、トレース スナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場面：

- Subcolumnizationスケールが極端に大きくなる場合（10,000パスに近づく）、ハードウェア要件が急速に上昇します。DOCモードはこのスケールでより安定した選択肢です。
- コンパクション メモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5～10倍向上できます。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムから文書を再構築することを避け、桁違いの高速化を実現します。

**使い始める：**

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
ingest スループットが最優先事項である場合、ワークロードで完全な JSON ドキュメントを頻繁に取得する必要がある場合、または非常に幅の広いカラムを `SELECT variant_col` で頻繁に読み取る場合に使用してください。

注意点:
- DOC モードは、すべての幅の広い JSON ワークロードに対するデフォルトの解決策ではありません。ホットパス分析が主要である場合、通常は sparse columns の方が適しています。
- DOC モードと sparse columns は相互に排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は Schema Template を選択してください。

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
ビジネスクリティカルなフィールドが少数のみで、それらのパスがより厳密な型付けやパスレベルのインデックス戦略を必要とする場合に使用してください。必要に応じてSchema Templateをスパース列やデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSONスキーマ全体を静的テンプレートに変換しないでください。`VARIANT`の意味がなくなります。
- Schema Templateは重要なパスのみをカバーし、残りは動的なままにしてください。

## パフォーマンス

以下のチャートは、10K-path wide-columnデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

- **マテリアライズドサブカラムが最高性能。** DefaultとDOC Materializedの両方で約76 msを実現 — 生のSTRINGより80倍、JSONBより12倍高速です。
- **シャーディング付きDOC Mapが効果的。** docマップのシャーディングにより、マテリアライズされていないパスのクエリ時間が2.5秒から148 msに短縮されます。
- **JSONBとSTRINGはメモリを大量消費。** VARIANTモードの1 MiBに対し、32-48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポート段階

- **新しい`VARIANT`テーブルではStorage Format V3から始める。** V3はカラムメタデータをセグメントフッターから分離します。これなしでは、wide JSON ワークロードでファイル開放が遅く、メモリオーバーヘッドが高くなります。
- **Schema Templateで重要なパスを早期に固定する。** Schema Templateなしでは、システムが自動的に型を推測します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始め、症状に応じて調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI学習、コネクテッドビークル、ユーザータグシステムなど、異常に大規模なSubcolumnizationスケールと多くのパスレベルインデックスが必要なワークロードでのみ、シナリオ別に調整してください。1日目での過剰設定（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）は、効果の証拠なしに複雑さを追加します。

### クエリ段階

- **非常に幅広い`VARIANT`カラムに対して`SELECT *`をメインのクエリパターンとして使用しない。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`は全サブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようにパスを指定するより大幅に遅くなります。
- **クエリが型に依存する場合は常にサブパスをCASTする。** 型推測は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして保存されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違う可能性があります。

### 運用段階

- **コンパクション圧力を監視する。** サブカラムの増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎないかを確認してください。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更されると、ホットパスがスパースストレージに押し込まれ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型の競合を監視する。** 同一パスでの頻繁な型競合は、JSONB昇格とインデックス消失を避けるためにSchema Templateでそのパスをロックすべきことを示しています。

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
