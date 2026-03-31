---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する判断ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、よく使用されるパスでSubcolumnizationを使用します。

新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に、このガイドを使用してください。次のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが非常に幅広い場合、デフォルトの動作、sparse columns、DOCモードのうち、どれから始めるべきか？
- どの設定をデフォルトのままにしておき、どの設定を最初に変更すべきか？

既に`VARIANT`を使用することが決まっており、構文や型の規則のみが必要な場合は、[VARIANT](./VARIANT)に移動してください。最小限の実行可能なインポートの例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)に移動してください。

:::tip なぜVARIANTを選ぶのか
`VARIANT`はJSONの柔軟性を保ちつつ、DorisはよくアクセスされるパスにSubcolumnizationを適用することができます。これにより、事前にドキュメント全体のスキーマを固定することなく、一般的なフィルター、集計、パスレベルのインデックスが効果的に機能します。非常に幅広いJSONにおいては、ストレージ層の最適化により、より多くのパス数でもSubcolumnizationを実用的に保ちます。
:::

## VARIANTが適している場合

通常、以下のほとんどが当てはまる場合、`VARIANT`は良い選択肢です：

- 入力がJSONまたは時間とともにフィールドが進化するその他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- カラム型分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、多くの他のパスは動的なままでよい。

これらの条件が支配的な場合は静的カラムを優先してください：

- スキーマが安定しており、事前に分かっている。
- 中核となるフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別の分析ではなく、生JSONのアーカイブである。

## まず4つの質問

設定に触れる前に、これら4つの質問に答えてください。

### 1. 明確なホットパスがありますか？

クエリが同じJSONパスに繰り返し触れる場合、DorisはそれらのパスにSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も効果を発揮する場面です。

### 2. 少数のパスに固定型または安定したインデックスが必要ですか？

必要な場合は、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールド向けであり、ドキュメント全体を記述するためのものではありません。

### 3. これは本当に幅広いJSONになっていますか？

パス数が増え続け、メタデータの圧迫、コンパクションの圧迫、または顕著なクエリオーバーヘッドを引き起こし始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、ホットパス分析とドキュメント全体の返却のどちらがより重要ですか？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集計、インデックスである場合は、sparse columnsに傾く。
- 主な価値が取り込み効率またはドキュメント全体の返却である場合は、DOCモードに傾く。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** `VARIANT`カラムにデータが書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`カラムの宣言。型付けされ、インデックス可能で、予測可能でなければならない重要なビジネスフィールドに使用してください。可能なすべてのパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を引き起こし始めた場合、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールドの分離がある場合、sparse columnsはホットパスをSubcolumnizationに保ちつつ、コールド（ロングテール）パスを共有sparse storageにプッシュします。Sparse storageは、より良い読み取り並列性のために複数の物理カラムにわたってシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度で独立したカラム型サブカラムとして残り、何千ものロングテールパスは共有sparse storageに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のsparse columnが読み取りボトルネックになる可能性があります。Sparse shardingは、複数の物理カラム（`variant_sparse_hash_shard_count`）にわたってハッシュによってロングテールパスを分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延させ、さらに元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加ストレージのコストで高速な取り込みと効率的なドキュメント全体の返却が可能になります。Subcolumnizationは後でコンパクション中に実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み時にJSONは高速取り込みのためにDoc Storeにそのまま保存されます。サブカラムは後でコンパクション中に抽出されます。読み取り時には、パスベースのクエリ（例：`SELECT v['user_id']`）は完全なカラム速度で実体化されたサブカラムから読み取り、ドキュメント全体のクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスが実体化されているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスが既にサブカラムに抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルトの`VARIANT`と同じく、完全なカラム速度で読み取る。
- **DOC Map**: クエリされたパスがまだ実体化されていない。クエリは値を見つけるためにdoc map全体をスキャンする必要があり、幅広いJSONでは大幅に遅くなる。
- **DOC Map (Sharded)**: 同じフォールバックですが、`variant_doc_hash_shard_count`でdoc mapが複数の物理カラムに分散され、並列スキャンとはるかに高速な復旧が可能になる。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。任意の`VARIANT`テーブル、特に幅広いJSONに推奨されます。これは何千ものサブカラムが存在する場合のメタデータボトルネックを排除するためです。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告 / テレメトリ / ユーザープロファイル（幅広く、ホットパスが少ない） | Sparse + V3 | `variant_max_subcolumns_count`, `variant_sparse_hash_shard_count` |
| **C** | モデル出力 / トレース / アーカイブ（取り込み第一またはドキュメント全体の返却） | DOCモード + V3 | `variant_enable_doc_mode`, `variant_doc_materialization_min_rows` |
| **D** | 注文 / 支払い / デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリが少数の馴染みのあるパスに繰り返し触れるイベントログや監査ペイロード。

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
ワークロードが sparse columns や DOC mode を正当化するほど幅広いかどうかまだ確信が持てず、大部分の価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用します。

注意点：
- パスの増加が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count` を早期に上げないでください。
- JSON が幅広くない場合、sparse columns や DOC mode を有効にすると、利益なしに複雑さが増します。

### Sparse Mode

ペイロードが幅広いが、大部分のクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columns を選択してください。

典型的な例：数千のオプション属性を持つが、定期的にクエリされるのは数十のみの、広告、テレメトリ、またはプロファイル JSON。

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
合計キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、インデックス作成である場合に使用してください。

注意点:
- ホットパス解析がボトルネックの場合、まずDOCモードに飛びつかないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードで自動Subcolumnizationの適切な開始点です。事実上すべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を推奨します。

### DOC Mode {#doc-mode-template}

完全なJSONドキュメントを返すことや、パスベース解析の最適化よりも取り込みオーバーヘッドの最小化が重要な場合にDOCモードを選択してください。

典型的な例: モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSONドキュメント。

DOCモードが有効な場合:

- Subcolumnizationスケールが極めて大きくなると（10,000パスに近づくと）、ハードウェア要件が急速に上昇します。この規模ではDOCモードがより安定した選択肢です。
- コンパクション メモリはデフォルトの積極的Subcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5-10倍向上する可能性があります。
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
ingest throughputが最優先の場合、ワークロードが頻繁に完全なJSONドキュメントを必要とする場合、または`SELECT variant_col`で非常に幅の広いカラムがよく読み取られる場合に使用します。

注意点：
- DOCモードは、すべての幅広JSONワークロードに対するデフォルトの答えではありません。ホットパス分析が支配的な場合、通常はsparse columnsの方が適しています。
- DOCモードとsparse columnsは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は、Schema Templateを選択してください。

典型的な例：いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要があるorder、payment、またはdevice payloadです。

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
ビジネスクリティカルなフィールドが少なく、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。適切な場合はSchema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせます。

注意点：
- JSON スキーマ全体を静的テンプレートに変換しないでください。これは`VARIANT`の意味を台無しにします。
- Schema Templateは重要なパスのみをカバーし、残りは動的のままにしておく必要があります。

## パフォーマンス

以下のチャートは、10K パス幅のワイドカラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）における単一パス抽出時間を比較しています。

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

- **マテリアライズされたサブカラムが勝利。** DefaultとDOC Materializedの両方が約76 msを実現 — 生のSTRINGより80倍高速、JSONBより12倍高速。
- **シャーディングされたDOC Mapが効果的。** doc mapをシャーディングすることで、非マテリアライズパスのクエリ時間が2.5秒から148 msに短縮されます。
- **JSONBとSTRINGはメモリ消費が大きい。** VARIANTモードの1 MiBに対し、32-48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルにはStorage Format V3から始める。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、幅の広いJSONワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが高くなります。
- **Schema Templateを使用して早期に重要パスを固定する。** Schema Templateがないと、システムは自動的に型を推論します。同一パスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格し、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI学習、コネクテッドビークル、ユーザータグシステムなど、異常に大きなSubcolumnizationスケールと多数のパスレベルインデックスが必要なワークロードの場合にのみシナリオごとに調整します。初日から過度に設定すること（非常に大きな`variant_max_subcolumns_count`、不要な場合のDOCモード有効化）は、利益の証拠なしに複雑さを追加します。

### クエリフェーズ

- **非常に幅の広い`VARIANT`カラムに対してメインクエリパターンとして`SELECT *`を使用しない。** DOCモードがない場合、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は常にサブパスをCASTする。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているが整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視する。** サブカラムの増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合は、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認します。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージに押し込まれ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要パスをロックします。
- **型の競合を監視する。** 同一パスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにそのパスをSchema Templateでロックすべきことを示しています。

## クイック検証

テーブル作成後、すべてが正常に動作することを確認するために次の最小限のシーケンスを使用します：

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
