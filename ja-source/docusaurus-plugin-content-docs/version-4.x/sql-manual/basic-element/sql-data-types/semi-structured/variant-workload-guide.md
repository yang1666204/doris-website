---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTをいつ使用するか、default、sparse、DOCモード、Schema Templateの中からどれを選択するか、および設定をどこから始めるかの判断ガイド。"
}
---
## 概要

`VARIANT` は半構造化JSON を格納し、頻繁に使用されるパスに対してサブカラム化を適用します。

このガイドは新しい`VARIANT` ワークロードのモデル化方法を決定する際に使用してください。以下のような疑問に答えるのに役立ちます：

- このワークロードは`VARIANT` を使用すべきか、それとも静的カラムを使用すべきか？
- JSON が非常に幅広い場合、デフォルトの動作、スパースカラム、DOC モードのうちどれから始めるべきか？
- どの設定をデフォルトのままにして、どの設定を最初に変更すべきか？

`VARIANT` を使用することが既に決まっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT) を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant) を参照してください。

:::tip VARIANT を選ぶ理由
`VARIANT` はJSON の柔軟性を維持しながら、Doris が頻繁に使用されるパスに対してサブカラム化を適用できます。これにより、ドキュメントスキーマ全体を事前に固定することなく、一般的なフィルター、集計、パスレベルのインデックスが適切に動作します。非常に幅広いJSON において、ストレージ層の最適化により、はるかに多いパス数でもサブカラム化を実用的にします。
:::

## VARIANT が適している場合

以下の条件のほとんどが当てはまる場合、`VARIANT` は通常適しています：

- 入力がJSON または時間の経過とともにフィールドが進化するその他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- カラム型解析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が欲しい。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的のままでよい。

以下の条件が優勢な場合は静的カラムを優先してください：

- スキーマが安定しており、事前に既知である。
- コアフィールドが定期的に結合キー、ソートキー、または厳密に制御された型付きカラムとして使用される。
- 主な要件がパス別の分析ではなく、生のJSON をアーカイブすることである。

## 最初に答える4つの質問

設定に触れる前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスはあるか？

クエリが同じJSON パスに繰り返しアクセスする場合、Doris はそれらのパスに対してサブカラム化を継続して適用できます。これが`VARIANT` が最も役立つ場面です。

### 2. 一部のパスで固定型や安定したインデックスが必要か？

必要な場合は、それらのパスのみに Schema Template を使用してください。これは少数のビジネスクリティカルなフィールドを対象としており、ドキュメント全体を記述することを意図していません。

### 3. 実際に幅広いJSON になっているか？

パス数が増え続け、メタデータの負荷、コンパクションの負荷、または顕著なクエリのオーバーヘッドを生じ始めると、幅広いJSON の問題があります。

### 4. 幅広いJSON の場合、ホットパス解析とドキュメント全体の返却のどちらが重要か？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集計、インデックス作成である場合は、スパースカラムに傾く。
- 主な価値が取り込み効率またはドキュメント全体の返却である場合は、DOC モードに傾く。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています。実装の詳細については、[VARIANT](./VARIANT) を参照してください。

**サブカラム化。** `VARIANT` カラムにデータが書き込まれると、Doris は自動的にJSON パスを発見し、効率的な解析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT` カラム上の宣言です。型付き、インデックス可能、予測可能でなければならない主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**幅広いJSON。** 個別のパス数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストを増加させ始めると、幅広いJSON の問題があります。

**スパースカラム。** 幅広いJSON に明確なホット/コールドの分離がある場合、スパースカラムはホットパスをサブカラム化に保ちながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。スパースストレージは、より良い読み取り並列性のために複数の物理カラムにわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page` など）は完全な解析速度を持つ独立したカラム型サブカラムとして残り、数千のロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count` によって制御されます。

**スパースシャーディング。** ロングテールパス数が非常に大きい場合、単一のスパースカラムが読み取りボトルネックになる可能性があります。スパースシャーディングは、ロングテールパスをハッシュによって複数の物理カラム（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOC モード。** 書き込み時にサブカラム化を遅延し、さらに元のJSON をマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加ストレージのコストで高速な取り込みと効率的なドキュメント全体の返却が可能になります。サブカラム化は後でコンパクション中に実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み中にJSON は高速取り込みのためにDoc Store にそのまま保存されます。サブカラムは後でコンパクション中に抽出されます。読み取り時に、パスベースのクエリ（例：`SELECT v['user_id']`）は完全なカラム速度でマテリアライズされたサブカラムから読み取り、ドキュメント全体のクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Store から直接読み取ります。

DOC モードには、クエリされたパスがマテリアライズされているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスが既にサブカラムに抽出されている（コンパクション後または`variant_doc_materialization_min_rows` が満たされた時）。デフォルト VARIANT と同じく、完全なカラム速度で読み取る。
- **DOC Map**: クエリされたパスがまだマテリアライズされていない。クエリは値を見つけるためにdoc map 全体のスキャンにフォールバックする — 幅広いJSON では著しく遅くなる。
- **DOC Map (Sharded)**: 同じフォールバックだが、`variant_doc_hash_shard_count` でdoc map が複数の物理カラムに分散され、並列スキャンとはるかに高速な回復が可能になる。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。特に幅広いJSON の場合、数千のサブカラムが存在する際のメタデータボトルネックを排除するため、すべての`VARIANT` テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

以下のテーブルを使用して開始点を選択し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | デフォルト VARIANT + V3 | デフォルトを維持 |
| **B** | 広告 / テレメトリ / ユーザープロファイル（幅広く、ホットパスが少ない） | スパース + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力 / トレース / アーカイブ（取り込み優先またはドキュメント全体の返却） | DOC モード + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文 / 支払い / デバイス（キーパスで安定した型が必要） | Schema Template + A または B | キーパスのみを定義 |

### デフォルトモード

これはほとんどの新しい`VARIANT` ワークロードにとって最も安全な開始点です。

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
ワークロードがsparse columnsやDOCモードを正当化するのに十分な幅を持つかどうかまだ確信が持てず、依然として価値の大部分がいくつかの共通パスでのフィルタリング、集約、およびグループ化から得られる場合に使用します。

注意点:
- パスの増加が既に負荷の原因となっていない限り、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると利益なしに複雑性が増します。

### Sparse Mode

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合はsparse columnsを選択します。

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
全体のキー数が非常に多いが、主要なワークロードがまだパスベースのフィルタリング、集約、およびインデックス作成である場合に使用してください。

注意事項:
- ホットパス分析がボトルネックである場合、最初にDOCモードに飛び移らないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これは既にほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。事実上すべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を優先してください。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや取り込みオーバーヘッドを最小化することが、パスベース分析の最適化よりも重要である場合にDOCモードを選択してください。

典型的な例：モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが役立つ場合：

- Subcolumnizationスケールが極めて大きくなる場合（10,000パスに近づく）、ハードウェア要件が急速に増加します。この規模ではDOCモードがより安定した選択肢です。
- 圧縮メモリはデフォルトの積極的Subcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5～10倍改善できます。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムから文書を再構築することを回避し、桁違いの高速化を実現します。

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
インジェストのスループットが最優先の場合、ワークロードで完全なJSONドキュメントを頻繁に取得する必要がある場合、または非常に幅広いカラムを`SELECT variant_col`で頻繁に読み取る場合に使用します。

注意点:
- DOCモードは、すべての幅広いJSONワークロードに対するデフォルトの解決策ではありません。ホットパス分析が支配的な場合、通常はsparse columnsの方が適しています。
- DOCモードとsparse columnsは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択します。

典型的な例: 注文、支払い、またはデバイスのペイロードで、少数のビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型指定やパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合は、Schema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON スキーマ全体を静的テンプレートにしないでください。それは`VARIANT`の意味を台無しにします。
- Schema Templateは主要なパスのみをカバーし、残りは動的なままにしてください。

## パフォーマンス

以下のグラフは、10Kパス幅広カラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

- **マテリアライズドサブカラムが勝利。** DefaultとDOC Materializedの両方が約76msを実現 — 生のSTRINGより80倍、JSONBより12倍高速。
- **シャーディング付きDOC Mapが効果的。** docマップをシャーディングすることで、非マテリアライズドパスのクエリ時間が2.5秒から148msに短縮。
- **JSONBとSTRINGはメモリを大量消費。** VARIANTモードの1 MiBに対し、32-48 GiBのピークメモリを消費。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルにはStorage Format V3から開始してください。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、幅広JSONワークロードでファイルオープンが遅くなり、メモリオーバーヘッドが大きくなります。
- **Schema Templateで主要パスを早期に固定してください。** Schema Templateがないと、システムは自動的に型を推論します。同じパスがバッチ間で型を変更すると（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整してください。** ほとんどのワークロードでは、デフォルトで十分です。AI学習、コネクテッドビークル、ユーザータグシステムなど、異常に大規模なSubcolumnizationスケールと多数のパスレベルインデックスが必要なワークロードでのみ、シナリオ別に調整してください。初日の過剰設定（非常に大きな`variant_max_subcolumns_count`、不要な場合のDOCモード有効化）は、利点の証拠なしに複雑性を追加します。

### クエリフェーズ

- **非常に幅広い`VARIANT`カラムで`SELECT *`をメインクエリパターンとして使用しないでください。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスをCASTしてください。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違う可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視してください。** サブカラムの増加はマージコストを増大させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **スキーマドリフトを監視してください。** JSON構造が頻繁に変更されると、ホットパスがスパースストレージに押し込まれ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視してください。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにSchema Templateでパスをロックすべきことを示しています。

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
