---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xにおけるVARIANTの使用タイミング、sparse columnsの有効化タイミング、およびSchema TemplateやPath固有のインデックスの追加タイミングに関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを保存し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

このガイドはDoris 3.xで新しい`VARIANT`ワークロードを計画する際に使用してください。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`と静的カラムのどちらを使用すべきか？
- JSONが広範囲になる場合、デフォルトの動作を維持するべきか、スパースカラムを有効にするべきか？
- いつSchema Templateやパス固有のインデックスを追加すべきか？

`VARIANT`を使用することがすでに決まっており、構文や型のルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポートの例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip なぜVARIANTを選ぶのか
`VARIANT`はJSONの柔軟性を保ちながら、Dorisが頻繁に使用されるパスにSubcolumnizationを適用できるようにします。Doris 3.1以降では、広範囲のJSONにおいてホットパスをSubcolumnizationに保持し、ロングテールパスをスパースストレージに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.x機能境界
このガイドはDoris 3.xで利用可能な機能のみをカバーしています。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、パス固有のインデックスはDoris 3.1.0以降が必要です。新しいバージョンのDOCモードガイダンスはDoris 3.xには適用されません。
:::

## VARIANTが適合する場合

以下のすべてまたは大部分が当てはまる場合に`VARIANT`を使用してください：

- 入力がJSONまたは時間の経過とともにフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- カラム分析パフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が優先される場合は静的カラムを選択してください：

- スキーマが安定しており、事前に判明している。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別の分析ではなく、生のJSONをアーカイブすることやドキュメント全体を頻繁に返すことである。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラムサブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template（3.1+）。** 選択されたパスを安定した型に固定する`VARIANT`カラムの宣言。型付き、インデックス可能、かつ予測可能である必要がある主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が継続的に増加し、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストを増加させ始める場合、wide-JSONの問題があります。

**スパースカラム（3.1+）。** wide JSONに明確なホット/コールドの分離がある場合、スパースカラムはホットパスをSubcolumnizationに保持し、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するには`variant_max_subcolumns_count`を使用してください。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上記のように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラムサブカラムとして保持され、数千のロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

## 推奨判断パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリがドキュメント全体を返すwide JSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択ではありません。非常に広いカラムで`SELECT variant_col`を主なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト構成がすでに適切な開始点です。アクセスパターンが明らかに異常な場合にのみチューニングしてください。典型的な例には、AIトレーニング機能ペイロード、コネクテッドビークルテレメトリ、Doris 3.1以降で異常に大規模なSubcolumnizationと多くのパスレベルインデックスを必要とするユーザータグシステムが含まれます。

## ストレージモード

開始点を選ぶために以下のテーブルを使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | デフォルトVARIANT | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（広範囲、ホットパスが少ない） | スパース（3.1+） | `variant_max_subcolumns_count` |
| **C** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template（3.1+）+ AまたはB | キーパスのみを定義 |

### デフォルトモード

これはほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

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
ワークロードがsparse columnsを正当化するのに十分な幅があるかどうかまだ確信が持てず、ほとんどの価値がいくつかの共通パスでのフィルタリング、集約、およびグループ化から得られる場合に使用してください。

注意点：
- パスの増加が既に圧迫を引き起こしていない限り、`variant_max_subcolumns_count`を早期に上げないでください。
- JSONが幅広くない場合、sparse columnsを有効にすると利益なしに複雑性が増します。

### Sparse Mode

> このテンプレートはDoris 3.1.0以降が必要です。

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合はsparse columnsを選択してください。

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
全体のキー数は非常に大きいが、主要なワークロードがパスベースのフィルタリング、集約、インデックス化である場合に使用してください。

注意点:
- ホットパス分析がボトルネックの場合、sparse columnsが3.xでは正しい方向性です。
- `variant_max_subcolumns_count`を大きく設定しすぎて、実質的にすべてのパスがSubcolumnizationを通るようにしないでください。これは目的に反し、メタデータと圧縮コストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択してください。

典型的な例：注文、支払い、またはデバイスペイロードにおいて、少数のビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスがより厳密な型付けやパスレベルのインデックス戦略を必要とする場合に使用します。適切な場合はSchema Templateをスパース列やデフォルトの`VARIANT`と組み合わせます。

注意点：
- JSON スキーマ全体を静的テンプレートに変換しないでください。それでは`VARIANT`の意味がありません。
- Schema Template は主要なパスのみをカバーし、残りは動的なままにしておきます。

## パフォーマンス

以下のチャートは、10K パス幅の wide-column データセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）における単一パス抽出時間を比較しています。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| モード | クエリ時間 | ピークメモリ |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

重要なポイント：

- **VARIANT Default が最速です。** 76 ms — JSONB より12倍高速、生の STRING より80倍高速。
- **JSONB と STRING はメモリ使用量が多い。** VARIANT の1 MiB に対して、32〜48 GiB のピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **Schema Template を使用して主要パスを早期に固定（3.1+）。** Schema Template なしでは、システムが自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONB に昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に基づいて調整。** ほとんどのワークロードでは、デフォルト設定で十分です。AI トレーニング、コネクテッドカー、ユーザータグシステムなどのワークロードが異常に大きな Subcolumnization スケールと Doris 3.1 以降の多くのパスレベルインデックスを必要とする場合のみ、シナリオに応じて調整します。初日から過剰に設定する（非常に大きな`variant_max_subcolumns_count`）と、利益の証拠なしに複雑性が増加します。

### クエリフェーズ

- **非常に幅広い`VARIANT`列のメインクエリパターンとして`SELECT *`を使用しない。** Doris 3.x には DOC モードがないため、`SELECT *` や `SELECT variant_col` はすべてのサブ列から JSON を再構築する必要があり、幅広い列では非常に高コストです。
- **クエリが型に依存する場合は常にサブパスを CAST する。** 型推論は期待と一致しない場合があります。`v['id']` が実際には STRING として格納されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視する。** サブ列の増加によりマージコストが増加します。Compaction Score が上昇し続ける場合、`variant_max_subcolumns_count` が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **スキーマドリフトを監視する。** JSON 構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Template で重要なパスをロックしてください。
- **型の競合を監視する。** 同じパスで頻繁な型競合が発生する場合、JSONB 昇格とインデックス損失を避けるために Schema Template でパスをロックする必要があることを示しています。

## クイック検証

テーブル作成後、以下の最小限のシーケンスを使用してすべてが機能することを確認してください：

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
