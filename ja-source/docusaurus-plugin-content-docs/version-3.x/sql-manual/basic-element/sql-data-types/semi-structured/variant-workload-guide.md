---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xでVARIANTを使用するタイミング、sparse columnsを有効化するタイミング、およびSchema TemplateやPath固有のインデックスを追加するタイミングの判断ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを保存し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

このガイドは、Doris 3.xで新しい`VARIANT`ワークロードを計画している際に使用してください。以下のような疑問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが大きくなっている場合、デフォルトの動作を維持すべきか、それともスパースカラムを有効にすべきか？
- いつSchema TemplateやPath固有のインデックスを追加すべきか？

すでに`VARIANT`を使用したいことが分かっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip なぜVARIANTを選ぶのか
`VARIANT`はJSONの柔軟性を保ちながら、DorisがSubcolumnizationを頻繁に使用されるパスに適用することを可能にします。Doris 3.1以降では、大きなJSONでもホットパスをSubcolumnizationに保持しながら、ロングテールパスをスパースストレージに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.x機能範囲
このガイドはDoris 3.xで利用可能な機能のみをカバーしています。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、およびパス固有インデックスは、Doris 3.1.0以降が必要です。新しいバージョンのDOCモードガイダンスは、Doris 3.xには適用されません。
:::

## VARIANTが適している場合

以下の条件のすべてまたは大部分が当てはまる場合に`VARIANT`を使用してください：

- 入力がJSONまたは時間の経過とともにフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- 列指向分析パフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、多くの他のパスは動的のままで構わない。

以下の条件が支配的な場合は、静的カラムを選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件が、パス別の分析ではなく、生JSONのアーカイブまたは文書全体の頻繁な返却である。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれは2-3行で説明されています；実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれる際、DorisはJSONパスを自動的に発見し、ホットパスを効率的な分析のための独立した列指向サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template (3.1+)。** 選択されたパスを安定した型に固定する`VARIANT`カラムの宣言です。型付け、インデックス化、予測可能性を保持する必要がある主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始する場合、wide-JSONの問題があります。

**Sparse columns (3.1+)。** wide JSONに明確なホット/コールドの分離がある場合、スパースカラムはホットパスをSubcolumnizationに保持しながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するには`variant_max_subcolumns_count`を使用してください。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立した列指向サブカラムとして維持され、一方で数千のロングテールパスは共有スパースストレージに収束されます。閾値は`variant_max_subcolumns_count`によって制御されます。

## 推奨決定パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリが文書全体を返すwide JSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択肢ではありません。非常に大きなカラムで`SELECT variant_col`を主要なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト設定が既に適切な開始点です。アクセスパターンが明らかに異常な場合のみチューニングしてください。典型的な例には、AIトレーニング特徴量ペイロード、コネクテッドビークルテレメトリ、およびDoris 3.1以降で異常に大規模なSubcolumnizationと多くのパスレベルインデックスが必要なユーザータグシステムが含まれます。

## ストレージモード

開始点を選択するために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（大きく、ホットパスが少ない） | Sparse (3.1+) | `variant_max_subcolumns_count` |
| **C** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template (3.1+) + A または B | キーパスのみを定義 |

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
    "replication_num" = "1"
);
```
ワークロードが sparse columns を正当化するのに十分な幅があるかどうかまだ確信が持てない場合、そして大部分の価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用します。

注意点:
- パスの増加が既に圧迫を引き起こしていない限り、`variant_max_subcolumns_count` を早期に上げないでください。
- JSONが幅広くない場合、sparse columns を有効にすると利益なしに複雑性が増します。

### Sparse Mode

> このテンプレートは Doris 3.1.0 以降が必要です。

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに集中している場合は sparse columns を選択してください。

典型的な例: 広告、telemetry、または数千のオプション属性を持つが定期的にクエリされるのは数十のみの profile JSON。

```sql
CREATE TABLE IF NOT EXISTS telemetry_wide (
    ts DATETIME NOT NULL,
    device_id BIGINT NOT NULL,
    attributes VARIANT<
        'device_type' : STRING,
        'region' : STRING,
        properties(
            'variant_max_subcolumns_count' = '2048',
            'variant_enable_typed_paths_to_sparse' = 'true'
        )
    >
)
DUPLICATE KEY(`ts`, `device_id`)
DISTRIBUTED BY HASH(`device_id`) BUCKETS 32
PROPERTIES (
    "replication_num" = "1"
);
```
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、およびインデックス作成である場合に使用してください。

注意点：
- ホットパス分析がボトルネックの場合、sparse columnsが3.xでの正しい方向性です。
- `variant_max_subcolumns_count`を大きく設定しすぎて、事実上すべてのパスがSubcolumnizationを通るようにしないでください。それは目的に反し、メタデータと圧縮のコストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択してください。

典型例：注文、支払い、またはデバイスペイロードで、いくつかのビジネスクリティカルなパスが型付けされ検索可能な状態を維持する必要がある場合。

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
    "replication_num" = "1"
);
```
いくつかのフィールドのみがビジネスクリティカルで、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合は、Schema Templateとスパースカラムまたはデフォルトの`VARIANT`を組み合わせてください。

注意点:
- JSON スキーマ全体を静的テンプレートにしないでください。それは`VARIANT`の意味を台無しにします。
- Schema Template は重要なパスのみをカバーし、残りは動的なままにしてください。

## Performance

以下のグラフは、10Kパス幅の wide-column データセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）における単一パス抽出時間を比較したものです。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| Mode | Query Time | Peak Memory |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

主なポイント：

- **VARIANT Default が最速です。** 76 ms — JSONB より12倍速く、生の STRING より80倍速い。
- **JSONB と STRING はメモリを大量消費します。** VARIANT の 1 MiB に対して、32–48 GiB のピークメモリを消費します。

## Best Practices

### Import Phase

- **Schema Template を使用して重要なパスを早期に固定してください（3.1+）。** Schema Template がない場合、システムは自動的に型を推論します。同じパスでバッチ間で型が変わる場合（例：整数から文字列）、JSONB に昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整してください。** ほとんどのワークロードでは、デフォルトで十分です。AI トレーニング、コネクテッドカー、ユーザータグシステムなどのワークロードで、Doris 3.1 以降で異常に大きな Subcolumnization スケールと多くのパスレベルインデックスが必要な場合にのみ、シナリオ別に調整してください。初日から過度に設定する（非常に大きな `variant_max_subcolumns_count`）ことは、利益の証拠なしに複雑さを追加します。

### Query Phase

- **非常に幅の広い `VARIANT` カラムに対するメインクエリパターンとして `SELECT *` を使用しないでください。** Doris 3.x には DOC モードがないため、`SELECT *` または `SELECT variant_col` はすべてのサブカラムから JSON を再構築する必要があり、幅の広いカラムでは非常に高コストになります。
- **クエリが型に依存する場合は、必ずサブパスを CAST してください。** 型推論は期待通りでない場合があります。`v['id']` が実際には STRING として格納されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違っている可能性があります。

### Operations Phase

- **コンパクション圧力を監視してください。** サブカラムの増加はマージコストを増加させます。Compaction Score が上昇し続ける場合は、`variant_max_subcolumns_count` が高すぎるか、取り込み速度が速すぎないかを確認してください。
- **スキーマドリフトを監視してください。** JSON 構造が頻繁に変更される場合、ホットパスがスパースストレージに押し出され、突然のクエリ速度低下を引き起こす可能性があります。Schema Template で重要なパスをロックしてください。
- **型の競合を監視してください。** 同じパスで頻繁な型競合が発生する場合は、JSONB 昇格とインデックス失効を避けるために Schema Template でそのパスをロックする必要があることを示しています。

## Quick Verify

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
- [Inverted Index](../../../../table-design/index/inverted-index)
- [Full-Text Search Operators](../../operators/conditional-operators/full-text-search-operators)
