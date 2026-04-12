---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に使用してください。以下のような質問に答える手助けとなります：

- このワークロードは`VARIANT`を使用すべきか、それとも静的列を使用すべきか？
- JSONが非常に幅広い場合、デフォルトの動作、sparse columns、またはDOCモードから始めるべきか？
- どの設定をデフォルトのままにしておき、どれを最初に変更すべきか？

すでに`VARIANT`を使用したいことが分かっており、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。実行可能な最小のインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisは頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、ドキュメントスキーマ全体を事前に固定することなく、一般的なフィルタ、集約、パスレベルのインデックスが適切に機能します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに大きなパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

`VARIANT`は通常、以下の条件の大部分が当てはまる場合に適しています：

- 入力がJSONまたは時間とともにフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、各行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- 列指向分析パフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでも構わない。

以下の条件が支配的な場合は静的列を選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される。
- 主な要件がパスによる分析ではなく、生のJSONをアーカイブすることである。

## まず4つの質問

設定に触れる前に、この4つの質問に答えてください。

### 1. 明確なホットパスがありますか？

クエリが同じJSONパスを繰り返し触れる場合、DorisはそれらのパスにSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も役立つ場面です。

### 2. 固定型や安定したインデックスが必要なパスはありますか？

はいの場合、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールドのためのもので、ドキュメント全体を記述するためのものではありません。

### 3. 本当に幅広いJSONになっていますか？

パス数が増え続け、メタデータの圧迫、コンパクションの圧迫、または顕著なクエリオーバーヘッドを生み出し始めている場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、どちらがより重要ですか：ホットパス分析か、ドキュメント全体の返却か？

- 主な価値がパスベースのフィルタリング、集約、ホットフィールドのインデックスである場合は、sparse columnsを選択してください。
- 主な価値が取り込み効率またはドキュメント全体の返却である場合は、DOCモードを選択してください。

## 主要な概念

以下のストレージモードを読む前に、これらの用語を明確にしてください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** `VARIANT`列にデータが書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列指向subcolumnとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`列の宣言です。型付きで、インデックス可能で、予測可能である必要がある主要なビジネスフィールドに使用してください。可能なすべてのパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始している場合、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールドの分離がある場合、sparse columnsはホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有sparse storageにプッシュします。Sparse storageは、より良い読み取り並列性のために複数の物理列にわたるシャーディングをサポートしています。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立した列指向subcolumnとして留まり、何千ものロングテールパスは共有sparse storageに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のsparse columnが読み取りボトルネックになることがあります。Sparse shardingは、ロングテールパスをハッシュにより複数の物理列（`variant_sparse_hash_shard_count`）に分散させ、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時のSubcolumnizationを遅延させ、さらに元のJSONをmap形式のストアドフィールド（**doc map**）として格納します。これにより、追加ストレージのコストで高速取り込みと効率的なドキュメント全体の返却が可能になります。Subcolumnizationは後でコンパクション中に実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み中はJSONが高速取り込みのためDoc Storeにそのまま保持されます。Subcolumnはコンパクション中に後で抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）はマテリアライズされたsubcolumnから完全な列指向速度で読み取り、ドキュメント全体のクエリ（`SELECT v`）はsubcolumnから再構築することなく、Doc Storeから直接読み取ります。

DOCモードには、クエリされたパスがマテリアライズされているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**：クエリされたパスがすでにsubcolumnに抽出されている場合（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルトのVARIANTと同じ、完全な列指向速度で読み取ります。
- **DOC Map**：クエリされたパスがまだマテリアライズされていない場合。クエリは値を見つけるためdoc map全体をスキャンするフォールバックを行います — 幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**：同じフォールバックですが、`variant_doc_hash_shard_count`でdoc mapが複数の物理列に分散され、並列スキャンとはるかに高速な復旧が可能になります。

**Storage Format V3。** 列メタデータをセグメントフッターから分離します。あらゆる`VARIANT`テーブル、特に幅広いJSONに推奨されます。何千ものsubcolumnが存在する場合のメタデータボトルネックを解消するためです。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

以下の表を使用して開始点を選択し、対応するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告 / テレメトリ / ユーザープロファイル（幅広い、ホットパスは少ない） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力 / トレース / アーカイブ（取り込み優先またはドキュメント全体の返却） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文 / 支払い / デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリが少数の馴染みのあるパスを繰り返し触れるイベントログや監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化するのに十分な幅があるかどうかまだ確信が持てず、フィルタリング、集計、および一般的なパスでのグループ化から依然として最も価値が得られる場合に使用します。

注意点：
- パスの増加が既に負荷を引き起こしていない限り、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすることは、利益なしに複雑性を追加します。

### Sparseモード

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columnsを選択してください。

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
全体のキー数が非常に大きいが、主要なワークロードがパスベースのフィルタリング、集計、インデックス作成である場合に使用してください。

注意点:
- ホットパス分析がボトルネックの場合、最初にDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これは既にほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOCモード](#doc-mode-template)を選択してください。

### DOCモード {#doc-mode-template}

JSON文書全体を返すことや取り込みオーバーヘッドを最小化することが、パスベース分析の最適化よりも重要な場合にDOCモードを選択してください。

典型的な例: モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合:

- Subcolumnizationスケールが極めて大きくなる場合（10,000パスに近づく場合）、ハードウェア要件が急速に上昇します。DOCモードはこのスケールにおいてより安定した選択です。
- コンパクション メモリは、デフォルトの積極的なSubcolumnizationと比較して約3分の2削減できます。
- スパースワイドカラム取り込みワークロードでは、スループットを約5〜10倍改善できます。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムから文書を再構築することを回避し、桁違いのスピードアップを実現します。

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
ingest throughputが最優先事項である場合、ワークロードが頻繁に完全なJSON文書を必要とする場合、または`SELECT variant_col`で非常に幅の広いカラムがしばしば読み取られる場合に使用します。

注意点：
- DOCモードは、すべての幅広JSON ワークロードに対するデフォルトの解決策ではありません。ホットパス分析が支配的である場合、通常はsparse columnsの方が適しています。
- DOCモードとsparse columnsは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択します。

典型的な例：いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある注文、支払い、またはデバイスのペイロード。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。必要に応じてSchema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせます。

注意点：
- JSON スキーマ全体を静的なテンプレートにしないでください。これでは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的にしておきます。

## Performance

以下のチャートは、10K-pathワイドカラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

- **物理化されたサブカラムが最も優秀です。** DefaultとDOC Materializedの両方とも約76 msを実現 — 生のSTRINGより80倍高速、JSONBより12倍高速です。
- **DOC MapとシャーディングによってQuerTime が改善されます。** doc mapをシャーディングすることで、非物理化パスのクエリ時間が2.5秒から148 msに短縮されました。
- **JSONBとSTRINGはメモリ使用量が大きいです。** VARIANTモードの1 MiBに対し、32-48 GiBのピークメモリを消費します。

## Best Practices

### Import Phase

- **新しい`VARIANT`テーブルではStorage Format V3から始めてください。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、ワイドJSONワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが高くなります。
- **Schema Templateを使って早期に主要パスを固定してください。** Schema Templateがないと、システムは自動的に型を推論します。バッチ間で同じパスが型を変更すると（例：整数から文字列）、JSONBに昇格され、そのパス上のインデックスが失われます。
- **デフォルト設定から始めて、症状に基づいて調整してください。** ほとんどのワークロードでは、デフォルトで十分です。AI訓練、接続車両、ユーザータグシステムなどのワークロードで異常に大きなSubcolumnizationスケールと多数のパスレベルインデックスが必要な場合のみ、シナリオに応じて調整してください。初日での過度な設定（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）は、利益の根拠なしに複雑さを増すだけです。

### Query Phase

- **非常にワイドな`VARIANT`カラムでは`SELECT *`をメインのクエリパターンとして使用しないでください。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようにパスを指定するよりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスをCASTしてください。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違う可能性があります。

### Operations Phase

- **コンパクション圧力を監視してください。** サブカラムの増加はマージコストを増大させます。Compaction Scoreが上昇し続ける場合は、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視してください。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージに押し出され、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型の競合を監視してください。** 同じパスで頻繁に型の競合が発生する場合は、JSONB昇格とインデックス損失を避けるためにSchema Template経由でパスをロックする必要があることを示しています。

## Quick Verify

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
