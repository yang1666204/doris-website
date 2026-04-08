---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、よく使用されるパスにSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に使用します。次のような疑問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的列を使用すべきか？
- JSONが非常に幅広い場合、デフォルト動作、スパース列、またはDOCモードのどれから始めるべきか？
- どの設定をデフォルトのままにして、どれを最初に変更すべきか？

すでに`VARIANT`を使用することが決まっており、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポートの例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisはよく使用されるパスにSubcolumnizationを適用できます。これにより、ドキュメントスキーマ全体を事前に固定することなく、一般的なフィルタ、集計、パスレベルのインデックスが適切に機能します。非常に幅広いJSONでは、ストレージ層の最適化により、はるかに大きなパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

`VARIANT`は通常、以下の大部分が当てはまる場合に適しています：

- 入力がJSONまたは時間の経過とともにフィールドが変化するその他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- カラム型分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が欲しい。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が支配的な場合は、静的列を選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される。
- 主な要件がパスによる分析ではなく、生のJSONをアーカイブすることである。

## 最初の4つの質問

設定に触れる前に、これら4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスを繰り返し触れる場合、Dorisはそれらのパスに対してSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も役立つところです。

### 2. 固定型または安定したインデックスが必要なパスが少数ありますか？

ある場合は、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールドを対象としており、ドキュメント全体を記述するためのものではありません。

### 3. これは本当に幅広いJSONになりつつありますか？

パス数が増え続け、メタデータの負荷、コンパクションの負荷、または顕著なクエリオーバーヘッドが発生し始めている場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、ホットパス分析とドキュメント全体の返却のどちらがより重要ですか？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集計、インデックス化である場合は、スパース列に傾倒します。
- 主な価値が取り込み効率またはドキュメント全体の返却である場合は、DOCモードに傾倒します。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** `VARIANT`列にデータが書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`列の宣言です。型付け、インデックス付け、予測可能性が必要な主要なビジネスフィールドに使用してください。可能なすべてのパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始している場合、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールドの分割がある場合、スパース列はホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。スパースストレージは、読み取り並列性を向上させるために複数の物理列にわたってシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして残り、数千のロングテールパスは共有スパースストレージに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のスパース列が読み取りボトルネックになることがあります。スパースシャーディングは、ロングテールパスをハッシュによって複数の物理列（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時のSubcolumnizationを遅延させ、さらに元のJSONをマップ形式の格納フィールド（**docマップ**）として保存します。これにより、追加のストレージコストをかけて高速な取り込みと効率的なドキュメント全体の返却が可能になります。Subcolumnizationは後でコンパクション中に実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み時にJSONは高速な取り込みのためにDoc Storeにそのまま保存されます。サブカラムは後でコンパクション中に抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全なカラム型速度で実体化されたサブカラムから読み取り、ドキュメント全体のクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスが実体化されているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**：クエリされたパスがすでにサブカラムに抽出されている場合（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトVARIANTと同じく、完全なカラム型速度で読み取ります。
- **DOC Map**：クエリされたパスがまだ実体化されていない場合。クエリは値を見つけるためにdocマップ全体をスキャンするフォールバックを行います — 幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**：同じフォールバックですが、`variant_doc_hash_shard_count`でdocマップが複数の物理列に分散され、並列スキャンとはるかに高速な復旧が可能になります。

**Storage Format V3。** 列メタデータをセグメントフッターから分離します。任意の`VARIANT`テーブル、特に幅広いJSONに推奨されます。数千のサブカラムが存在する場合のメタデータボトルネックを排除するからです。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

以下の表を使用して開始点を選択し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広く、ホットパスが少ない） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（取り込み優先またはドキュメント全体返却） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + AまたはB | キーパスのみを定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリが少数の馴染みのあるパスを繰り返し触れるイベントログまたは監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化するのに十分な幅があるかどうかまだ確信が持てず、主な価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点：
- パスの増加が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に引き上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると利益なしに複雑さが増します。

### Sparseモード

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合にsparse columnsを選択してください。

典型的な例：広告、テレメトリ、または数千のオプション属性を持つがレギュラーにクエリされるのは数十のみのプロファイルJSON。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集計、インデックス作成である場合に使用します。

注意点：
- ホットパス分析がボトルネックの場合、最初にDOCモードにジャンプしないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`であり、これはほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を優先してください。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや取り込みオーバーヘッドの最小化がパスベース分析の最適化よりも重要な場合は、DOCモードを選択してください。

典型的な例：モデル応答、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合：

- Subcolumnizationスケールが極めて大きくなる場合（10,000パスに近づく）、ハードウェア要件が急速に上昇します。この規模ではDOCモードがより安定した選択です。
- コンパクション メモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5〜10倍向上する可能性があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムからの文書再構築を回避し、桁違いの高速化を実現します。

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
ingest のスループットが最優先の場合、ワークロードで完全な JSON ドキュメントを頻繁に戻す必要がある場合、または非常にワイドなカラムが `SELECT variant_col` でよく読み取られる場合に使用します。

注意点：
- DOC モードは、すべてのワイド JSON ワークロードのデフォルトの答えではありません。ホットパス分析が支配的な場合、通常はスパースカラムの方が適しています。
- DOC モードとスパースカラムは相互に排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は Schema Template を選択します。

典型的な例：いくつかのビジネスクリティカルなパスが型付けされ検索可能な状態を維持する必要がある注文、支払い、またはデバイスのペイロード。

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
ビジネスクリティカルなフィールドが少数であり、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合は、Schema Templateをスパース列やデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON スキーマ全体を静的テンプレートにしないでください。これは`VARIANT`の利点を失います。
- Schema Templateは主要なパスのみをカバーし、残りは動的に保つべきです。

## パフォーマンス

以下のチャートは、10K パス幅広カラムデータセット（200K 行、1つのキーを抽出、16 CPU、3回実行の中央値）でのシングルパス抽出時間を比較したものです。

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

- **マテリアライズされたサブカラムが最優秀。** DefaultとDOC Materializedの両方が約76 msを実現 — 生のSTRINGより80倍高速、JSONBより12倍高速。
- **シャーディングされたDOC Mapが有効。** doc mapをシャーディングすることで、マテリアライズされていないパスのクエリ時間が2.5秒から148ミリ秒に短縮されました。
- **JSONBとSTRINGはメモリ消費が大きい。** VARIANTモードの1 MiBに対し、32–48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポート段階

- **新しい`VARIANT`テーブルにはStorage Format V3から始める。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、幅広JSONワークロードでファイル開放の遅延と高いメモリオーバーヘッドが発生します。
- **Schema Templateを使用して主要パスを早期に固定する。** Schema Templateがないと、システムは型を自動推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列へ）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状に基づいて調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI トレーニング、コネクテッドカー、ユーザータグシステムなどのワークロードで異常に大きなSubcolumnizationスケールと多くのパスレベルインデックスが必要な場合のみ、シナリオに応じて調整してください。初日から過度な設定（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）を行うと、利益の証拠なしに複雑さが増します。

### クエリ段階

- **非常に幅広い`VARIANT`列では`SELECT *`を主要なクエリパターンとして使用しない。** DOCモードなしでは、`SELECT *`または`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は常にサブパスをCASTする。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較する場合、インデックスが使用されず結果が間違っている可能性があります。

### 運用段階

- **コンパクション圧力を監視する。** サブカラムの増大はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視する。** 同じパスでの頻繁な型競合は、そのパスがSchema Templateでロックされるべきであることを示し、JSONB昇格とインデックス損失を回避します。

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
