---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをモデル化する方法を決定する際に使用してください。次のような質問に答える助けとなります：

- このワークロードは`VARIANT`を使用すべきか、静的カラムを使用すべきか？
- JSONが非常に幅広い場合、デフォルトの動作、スパースカラム、DOCモードのどれから始めるべきか？
- どの設定をデフォルトのまま残し、どの設定を最初に変更すべきか？

`VARIANT`を使用することが既に決まっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisが頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、ドキュメントスキーマ全体を事前に固定することなく、一般的なフィルター、集約、パスレベルのインデックスが効率的に動作します。非常に幅広いJSONでは、ストレージレイヤーの最適化により、はるかに多くのパス数でSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

以下のほとんどが当てはまる場合、`VARIANT`は通常適しています：

- 入力がJSONまたは時間の経過とともにフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- 列指向分析パフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が支配的な場合は、静的カラムを選択してください：

- スキーマが安定していて事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別の分析ではなく、生のJSONのアーカイブである。

## まず4つの質問

設定を触る前に、これらの4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、DorisはそれらのパスにSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も役立つ場面です。

### 2. いくつかのパスで固定型や安定したインデックスが必要ですか？

はいの場合、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールド向けであり、ドキュメント全体を記述するためのものではありません。

### 3. これは本当に幅広いJSONになっていますか？

パス数が増加し続け、メタデータの圧迫、コンパクションの圧迫、または顕著なクエリオーバーヘッドを引き起こし始めると、幅広いJSONの問題が発生します。

### 4. 幅広いJSONの場合、ホットパス分析とドキュメント全体の返却のどちらがより重要ですか？

- 主な価値がパスベースのフィルタリング、集約、ホットフィールドでのインデックスである場合は、スパースカラムに寄せる。
- 主な価値が取り込み効率またはドキュメント全体の返却である場合は、DOCモードに寄せる。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明しています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** `VARIANT`カラムにデータが書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列指向サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** `VARIANT`カラム上で、選択されたパスを安定した型に固定する宣言。型付けされ、インデックス可能で、予測可能でなければならない主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を引き起こし始めると、幅広いJSONの問題が発生します。

**スパースカラム。** 幅広いJSONに明確なホット/コールドの分離がある場合、スパースカラムはホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。スパースストレージは、より良い読み取り並列性のために複数の物理カラム間でのシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立した列指向サブカラムとして残り、数千のロングテールパスが共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**スパースシャーディング。** ロングテールパス数が非常に多い場合、単一のスパースカラムが読み取りボトルネックになる可能性があります。スパースシャーディングは、ロングテールパスをハッシュによって複数の物理カラム（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延させ、追加で元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加ストレージのコストで高速な取り込みと効率的なドキュメント全体の返却が可能になります。Subcolumnizationはコンパクション中に後で実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み中はJSONが高速な取り込みのためにDoc Storeにそのまま保存されます。サブカラムはコンパクション中に後で抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全な列指向速度で実体化されたサブカラムから読み取り、ドキュメント全体のクエリ（`SELECT v`）はサブカラムから再構築することなく、Doc Storeから直接読み取ります。

DOCモードは、クエリされたパスが実体化されているかどうかに応じて、3つの異なる読み取りパスを持ちます：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスが既にサブカラムに抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルト`VARIANT`と同様に、完全な列指向速度で読み取ります。
- **DOC Map**: クエリされたパスがまだ実体化されていない。クエリは値を見つけるためにdoc map全体をスキャンするフォールバックを行う—幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**: 同じフォールバックですが、`variant_doc_hash_shard_count`でdoc mapが複数の物理カラムに分散され、並列スキャンとはるかに高速な回復が可能になります。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。特に幅広いJSONにおいて、数千のサブカラムが存在する場合のメタデータボトルネックを排除するため、すべての`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために以下のテーブルを使用し、対応するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを保持 |
| **B** | 広告/テレメトリー/ユーザープロファイル（幅広く、ホットパスが少ない） | Sparse + V3 | `variant_max_subcolumns_count`, `variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（取り込み優先またはドキュメント全体返却） | DOC mode + V3 | `variant_enable_doc_mode`, `variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + A or B | キーパスのみ定義 |

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
ワークロードがsparse columnsやDOCモードを正当化するほど十分に広いかどうかまだ確信が持てず、大部分の価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用します。

注意点：
- パスの増加がすでに負荷を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが広くない場合、sparse columnsやDOCモードを有効にすると、利益なしに複雑性が増します。

### Sparseモード

ペイロードが広いが、ほとんどのクエリが依然として小さなホットパスのセットに焦点を当てている場合は、sparse columnsを選択します。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、およびインデックス化である場合に使用してください。

注意点:
- ホットパス分析がボトルネックである場合、最初にDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これは既にほとんどのワークロードでの自動Subcolumnizationの適切な開始点です。すべてのパスが実質的にSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOCモード](#doc-mode-template)を選択してください。

### DOCモード {#doc-mode-template}

JSON文書全体を返すか、パスベース分析の最適化よりも取り込みオーバーヘッドの最小化が重要な場合は、DOCモードを選択してください。

典型的な例：モデル応答、トレーススナップショット、または完全なペイロードとして頻繁に返されるアーカイブされたJSON文書。

DOCモードが有効な場合：

- Subcolumnizationスケールが極めて大きくなる場合（10,000パスに近づく場合）、ハードウェア要件が急速に増加します。この規模ではDOCモードがより安定した選択肢です。
- コンパクションメモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースワイドカラム取り込みワークロードでは、スループットが約5～10倍改善できます。
- クエリが`VARIANT`値全体（`SELECT variant_col`）を読み取る場合、DOCモードは数千のサブカラムから文書を再構築することを避け、桁違いの高速化を実現します。

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
ingest スループットが最優先事項である場合、ワークロードが完全な JSON ドキュメントを頻繁に必要とする場合、または非常に幅の広いカラムが `SELECT variant_col` でよく読み取られる場合に使用します。

注意点:
- DOC モードは、すべての wide-JSON ワークロードのデフォルトの回答ではありません。ホットパス分析が支配的である場合、sparse カラムの方が通常適しています。
- DOC モードと sparse カラムは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は Schema Template を選択します。

典型的な例: 少数のビジネスクリティカルなパスで型付けと検索可能性を維持する必要がある order、payment、または device ペイロード。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合は、Schema Templateとsparse columnsやデフォルトの`VARIANT`を組み合わせてください。

注意点：
- JSON schema全体を静的テンプレートにしないでください。これは`VARIANT`の利点を台無しにします。
- Schema Templateは主要なパスのみをカバーし、残りは動的のままにしてください。

## パフォーマンス

下のチャートは、10K-pathワイドカラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）でのシングルパス抽出時間を比較したものです。

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

- **Materializedサブカラムが勝利。** DefaultとDOC Materializedはどちらも約76 msを実現 — 生のSTRINGより80倍高速、JSONBより12倍高速。
- **DOC Mapとshardingが効果的。** doc mapをshardingすることで、un-materializedパスのクエリ時間が2.5秒から148 msに短縮されます。
- **JSONBとSTRINGはメモリ集約的。** VARIANTモードの1 MiBに対し、32–48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルにはStorage Format V3から開始してください。** V3はカラムメタデータをsegment footerから分離します。これがないと、ワイドJSONワークロードでファイルオープンの低速化と高いメモリオーバーヘッドが発生します。
- **Schema Templateで主要パスを早期に固定してください。** Schema Templateがないと、システムは型を自動的に推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に基づいて調整してください。** ほとんどのワークロードでは、デフォルトで十分です。AIトレーニング、コネクテッドビークル、ユーザータグシステムなどのワークロードで異常に大きなSubcolumnizationスケールと多くのパスレベルインデックスが必要な場合のみ、シナリオ別に調整してください。初日からの過度の設定（非常に大きな`variant_max_subcolumns_count`、不要時のDOCモード有効化）は、利益の証拠なしに複雑さを追加します。

### クエリフェーズ

- **非常にワイドな`VARIANT`カラムのメインクエリパターンとして`SELECT *`を使用しないでください。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`は全サブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようにパスを指定するよりもはるかに低速です。
- **クエリが型に依存する場合は、常にサブパスをCASTしてください。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **compaction圧力を監視してください。** サブカラムの増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合は、`variant_max_subcolumns_count`が高すぎるか、インジェスション率が速すぎるかを確認してください。
- **スキーマドリフトを監視してください。** JSON構造が頻繁に変更される場合、ホットパスがsparse storageに押し込まれ、突然のクエリ低速化を引き起こす可能性があります。Schema Templateで重要なパスを固定してください。
- **型の競合を監視してください。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス喪失を避けるため、Schema Templateでそのパスを固定すべきであることを示しています。

## クイック検証

テーブル作成後、すべてが動作することを確認するために、この最小限のシーケンスを使用してください：

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
