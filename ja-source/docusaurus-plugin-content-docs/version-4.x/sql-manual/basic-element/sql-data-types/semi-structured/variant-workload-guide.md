---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、そして設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

新しい`VARIANT`ワークロードをモデル化する方法を決定する際にこのガイドを使用してください。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、静的列を使用すべきか？
- JSONが非常に幅広い場合、デフォルトの動作、sparse列、またはDOCモードから始めるべきか？
- どの設定をデフォルトのままにしておくべきで、どれを最初に変更すべきか？

既に`VARIANT`を使用したいことが決まっていて、構文やタイプルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が欲しい場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip なぜVARIANTを選ぶのか
`VARIANT`はJSONを柔軟に保ちながら、Dorisは頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、文書スキーマ全体を事前に固定することなく、一般的なフィルタ、集約、パスレベルのインデックスが効率的に動作します。非常に幅広いJSONでは、ストレージレイヤーの最適化によりSubcolumnizationがはるかに大きなパス数でも実用的になります。
:::

## VARIANTが適している場合

`VARIANT`は通常、以下の大部分が当てはまる場合に適しています：

- 入力がJSONまたは他の半構造化ペイロードで、フィールドが時間とともに進化する。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- 列形式分析パフォーマンスを諦めることなくスキーマの柔軟性を求める。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままで良い。

以下の条件が支配的な場合は静的列を選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される。
- 主な要件がパス別分析ではなく、生JSONのアーカイブである。

## まず4つの質問

設定に触れる前に、これらの4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、DorisはそれらのパスにSubcolumnizationを継続的に適用できます。これは`VARIANT`が最も役立つ場面です。

### 2. 少数のパスに固定型または安定したインデックスが必要ですか？

はいの場合、それらのパスのみにSchema Templateを使用してください。これは少数の業務上重要なフィールドのためのものであり、文書全体を記述するためのものではありません。

### 3. これは本当に幅広いJSONになりつつありますか？

パス数が増え続け、メタデータ圧迫、コンパクション圧迫、または顕著なクエリオーバーヘッドを生み出し始めたときに、幅広いJSONの問題があります。

### 4. 幅広いJSONにおいて、ホットパス分析と文書全体の返却のどちらがより重要ですか？

- 主な価値がホットフィールドのパスベースフィルタリング、集約、インデックスである場合は、sparse列に傾く。
- 主な価値が取り込み効率や文書全体の返却である場合は、DOCモードに傾く。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`列に書き込まれるとき、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列形式のサブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`列での宣言。型付け、インデックス化、予測可能性を保つ必要がある主要な業務フィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を引き起こし始めたときに、幅広いJSONの問題があります。

**Sparse列。** 幅広いJSONに明確なホット/コールド分割がある場合、sparse列はホットパスをSubcolumnizationに保持しながら、コールド（ロングテール）パスを共有sparseストレージに押し込みます。Sparseストレージは読み取り並列性の向上のために複数の物理列でのシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度で独立した列形式のサブカラムとして残り、数千のロングテールパスが共有sparseストレージに収束します。閾値は`variant_max_subcolumns_count`で制御されます。

**Sparseシャーディング。** ロングテールパス数が非常に大きい場合、単一のsparse列が読み取りボトルネックになる可能性があります。Sparseシャーディングは、ハッシュによってロングテールパスを複数の物理列（`variant_sparse_hash_shard_count`）に分散し、並列スキャンを可能にします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延させ、さらに元のJSONをマップ形式のstored field（**doc map**）として保存します。これにより追加ストレージのコストで高速な取り込みと効率的な文書全体の返却を提供します。Subcolumnizationは後でコンパクション中に実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み中はJSONが高速取り込みのためにDoc Storeにそのまま保存されます。サブカラムは後でコンパクション中に抽出されます。読み取り時、パスベースクエリ（例：`SELECT v['user_id']`）はマテリアライズされたサブカラムから完全な列形式速度で読み取り、文書全体クエリ（`SELECT v`）はサブカラムから再構成することなくDoc Storeから直接読み取ります。

DOCモードには、クエリされたパスがマテリアライズされているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスが既にサブカラムに抽出されています（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトVARIANTと同じ完全な列形式速度で読み取ります。
- **DOC Map**: クエリされたパスがまだマテリアライズされていません。クエリは値を見つけるためにdoc map全体のスキャンにフォールバックします — 幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**: 同じフォールバック、ただし`variant_doc_hash_shard_count`でdoc mapが複数の物理列に分散され、並列スキャンとはるかに高速な復旧が可能になります。

**Storage Format V3。** 列メタデータをセグメントフッターから分離します。特に幅広いJSONにおいて、数千のサブカラムが存在する際にメタデータボトルネックを解消するため、すべての`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために下記の表を使用し、対応するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | デフォルトVARIANT + V3 | デフォルトを保持 |
| **B** | 広告/テレメトリー/ユーザープロファイル（幅広、ホットパス少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（取り込み優先または文書全体返却） | DOCモード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（主要パスに安定した型が必要） | Schema Template + AまたはB | 主要パスのみ定義 |

### デフォルトモード

これはほとんどの新しい`VARIANT`ワークロードにとって最も安全な出発点です。

典型例：クエリが少数の馴染みのあるパスに繰り返しアクセスするイベントログや監査ペイロード。

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
ワークロードがsparse columnsやDOCモードを正当化するほど十分に幅広いかどうかまだ確信が持てず、主な価値がいくつかの共通パスでのフィルタリング、集約、およびグループ化から得られる場合に使用します。

注意点:
- パスの増大が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすることは利益なしに複雑性を追加します。

### Sparseモード

ペイロードが幅広いが、ほとんどのクエリが依然として小さなホットパスのセットに焦点を当てている場合は、sparse columnsを選択します。

典型例: 数千のオプション属性を持つが定期的にクエリされるのは数十のみという広告、テレメトリ、またはプロファイルJSON。

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
総キー数が非常に大きいが、主要なワークロードがパスベースのフィルタリング、集約、インデックス作成である場合に使用します。

注意点:
- ホットパス分析がボトルネックの場合、最初にDOCモードにジャンプしないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これは既にほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大きな抽出サブカラムスケールを必要とする場合は、[DOCモード](#doc-mode-template)を優先してください。

### DOCモード {#doc-mode-template}

JSON文書全体を返すことや取り込みオーバーヘッドの最小化が、パスベース分析の最適化よりも重要な場合にDOCモードを選択します。

典型的な例: モデル応答、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが役立つ場合:

- Subcolumnizationスケールが極めて大きくなる場合（10,000パスに近づく場合）、ハードウェア要件が急速に上昇します。このスケールではDOCモードがより安定した選択肢です。
- コンパクションメモリは、デフォルトの積極的なSubcolumnizationと比較して約3分の2削減できます。
- 疎な幅広カラムの取り込みワークロードでは、スループットが約5～10倍向上する可能性があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムからの文書再構築を回避し、桁違いの高速化を実現します。

**使用開始:**

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
インジェストスループットが最優先の場合、ワークロードで完全なJSONドキュメントが頻繁に必要な場合、または`SELECT variant_col`で非常に幅の広いカラムを読み取ることが多い場合に使用してください。

注意点：
- DOCモードは、すべての幅の広いJSONワークロードに対するデフォルトの回答ではありません。ホットパス分析が主である場合、sparse columnsの方が通常適しています。
- DOCモードとsparse columnsは相互に排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は、Schema Templateを選択してください。

典型例：注文、支払い、またはデバイスペイロードで、いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスにより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。適切な場合はSchema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせます。

注意点:
- JSON スキーマ全体を静的テンプレートに変換しないでください。それでは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的なままにしておく必要があります。

## パフォーマンス

以下のチャートは、10K パス幅の wide-column データセット（200K 行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

主なポイント:

- **マテリアライズドサブカラムが最高。** Default と DOC Materialized はともに約76 ms を実現 — 生の STRING より 80倍高速、JSONB より 12倍高速。
- **DOC Map はシャーディングが有効。** doc map をシャーディングすることで、マテリアライズされていないパスのクエリ時間が 2.5 秒から 148 ms に短縮されます。
- **JSONB と STRING はメモリ使用量が多い。** VARIANT モードの 1 MiB に対し、32–48 GiB のピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルには Storage Format V3 から始める。** V3 はカラムメタデータをセグメントフッターから分離します。これがないと、ワイド JSON ワークロードはファイルオープンの遅延と高いメモリオーバーヘッドに悩まされます。
- **Schema Template で主要なパスを早期に固定する。** Schema Template がないと、システムは自動的に型を推測します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONB に昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始め、症状に応じて調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI トレーニング、コネクテッドビークル、ユーザータグシステムなどのワークロードが異常に大きな Subcolumnization スケールと多数のパスレベルインデックスを必要とする場合のみ、シナリオ別に調整します。初日に過度に設定する（非常に大きな`variant_max_subcolumns_count`、不要な時の DOC モード有効化）と、利点の証拠なしに複雑性が増します。

### クエリフェーズ

- **非常にワイドな`VARIANT`カラムでは`SELECT *`をメインのクエリパターンとして使用しない。** DOC モードなしでは、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きな JSON を再構築する必要があり、`SELECT v['path']`のようにパスを指定するよりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスをCASTする。** 型推論は期待と一致しない場合があります。`v['id']`が実際には STRING として保存されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違う可能性があります。

### 運用フェーズ

- **コンパクション負荷を監視する。** サブカラムの増加はマージコストを増加させます。Compaction Score が上昇し続ける場合は、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかをチェックします。
- **スキーマドリフトを監視する。** JSON 構造が頻繁に変更される場合、ホットパスがスパースストレージに押し込まれ、突然のクエリ遅延を引き起こす可能性があります。Schema Template で重要なパスをロックします。
- **型の競合を監視する。** 同じパス上での頻繁な型競合は、JSONB 昇格とインデックス損失を避けるために Schema Template でそのパスをロックすべきことを示しています。

## クイック検証

テーブル作成後、すべてが動作することを確認するために、この最小限のシーケンスを使用してください:

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
