---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xでVARIANTを使用するタイミング、sparse columnsを有効にするタイミング、およびSchema TemplateやPath固有のインデックスを追加するタイミングの決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

このガイドは、Doris 3.xで新しい`VARIANT`ワークロードを計画する際に使用します。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが広くなっている場合、デフォルト動作のままにすべきか、それともスパースカラムを有効にすべきか？
- Schema Templateやパス固有のインデックスをいつ追加すべきか？

すでに`VARIANT`を使用することが決まっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、DorisがSubcolumnizationを頻繁に使用されるパスに適用することを可能にします。Doris 3.1以降では、広いJSONでもホットパスをSubcolumnizationに保持しながら、ロングテールパスをスパースストレージに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.x機能境界
このガイドはDoris 3.xで利用可能な機能のみをカバーしています。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、およびパス固有のインデックスはDoris 3.1.0以降が必要です。新しいバージョンのDOCモードガイダンスはDoris 3.xには適用されません。
:::

## VARIANTが適している場合

以下のすべてまたはほとんどが当てはまる場合は`VARIANT`を使用してください：

- 入力がJSONまたは時間の経過とともにフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- カラム分析パフォーマンスを犠牲にすることなく、スキーマの柔軟性が欲しい。
- 一部のパスにはインデックスが必要で、その他多くのパスは動的なままで良い。

以下の条件が支配的な場合は、静的カラムを優先してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別の分析ではなく、生のJSONをアーカイブしたり、ドキュメント全体を頻繁に返すことである。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています；実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム状サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template (3.1+)。** 選択されたパスを安定した型に固定する`VARIANT`カラムに対する宣言。型付け、インデックス化、および予測可能である必要がある主要なビジネスフィールドに使用します。すべての可能なパスを列挙しようとしないでください。

**広いJSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始する場合、広いJSONの問題があります。

**スパースカラム (3.1+)。** 広いJSONに明確なホット/コールド分割がある場合、スパースカラムはホットパスをSubcolumnizationに保持しながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するには`variant_max_subcolumns_count`を使用します。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム状サブカラムとして残り、数千のロングテールパスは共有スパースストレージに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

## 推奨決定パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリがドキュメント全体を返す広いJSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択ではありません。非常に広いカラムで`SELECT variant_col`を主要なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト設定がすでに適切な出発点です。アクセスパターンが明らかに異常な場合のみ調整してください。典型的な例には、AIトレーニング機能ペイロード、コネクテッドビークルテレメトリ、およびDoris 3.1以降では異常に大規模なSubcolumnizationと多くのパスレベルインデックスが必要なユーザータグシステムが含まれます。

## ストレージモード

出発点を選ぶために下の表を使用し、対応するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT | デフォルトを保持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（広い、ホットパスは少ない） | Sparse (3.1+) | `variant_max_subcolumns_count` |
| **C** | 注文/支払い/デバイス（キーパスは安定した型が必要） | Schema Template (3.1+) + AまたはB | キーパスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な出発点です。

典型的な例：クエリが少数の馴染みのあるパスに繰り返しアクセスするイベントログまたは監査ペイロード。

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
ワークロードがsparse columnsを正当化するほど十分に広いかどうかまだ確信が持てず、ほとんどの価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点:
- パスの増加が既に負荷を引き起こしている場合を除き、早期に`variant_max_subcolumns_count`を上げないでください。
- JSONが広くない場合、sparse columnsを有効にすることは利益なしに複雑さを追加します。

### Sparse Mode

> このテンプレートはDoris 3.1.0以降が必要です。

ペイロードが広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合にsparse columnsを選択してください。

典型的な例: 数千のオプション属性を持つが定期的にクエリされるのは数十個のみの広告、テレメトリ、またはプロファイルJSON。

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
- ホットパス分析がボトルネックの場合、sparse columnsは3.xでの正しい方向です。
- `variant_max_subcolumns_count`を大きく設定しすぎて、事実上すべてのパスがSubcolumnizationを通るようにしないでください。これは目的に反し、メタデータとcompactionのコストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスが安定した型、安定した動作、またはパス固有のインデックスを必要とする場合にSchema Templateを選択してください。

典型的な例：注文、支払い、またはデバイスペイロードで、いくつかのビジネスクリティカルなパスが型付けされ検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスにより厳格な型指定やパスレベルのインデックス戦略が必要な場合に使用します。適切な場合は、Schema Templateをスパース列やデフォルトの`VARIANT`と組み合わせます。

注意点：
- JSON スキーマ全体を静的テンプレートに変換しないでください。これは`VARIANT`の意味を損ないます。
- Schema Template は主要なパスのみをカバーし、残りは動的のままにする必要があります。

## Performance

以下のグラフは、10K パス幅の wide-column データセット（200K 行、1つのキーを抽出、16 CPU、3回実行の中央値）における単一パス抽出時間を比較しています。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| Mode | Query Time | Peak Memory |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

主なポイント：

- **VARIANT Default が最高速です。** 76 ms — JSONB より12倍速く、raw STRING より80倍速いです。
- **JSONB と STRING はメモリを大量消費します。** VARIANT の 1 MiB に対して、32–48 GiB のピークメモリを消費します。

## Best Practices

### Import Phase

- **Schema Template を使用して主要パスを早期にピン留めする（3.1+）。** Schema Template がない場合、システムは自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONB に昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI トレーニング、コネクテッドビークル、ユーザータグシステムなどのワークロードが Doris 3.1 以降で異常に大規模な Subcolumnization スケールと多数のパスレベルインデックスを必要とする場合にのみ、シナリオ別に調整してください。初日から過度に設定する（非常に大きな`variant_max_subcolumns_count`）と、利益の証拠なしに複雑さが増します。

### Query Phase

- **非常に幅の広い`VARIANT`列に対してメインクエリパターンとして`SELECT *`を使用しないでください。** Doris 3.x には DOC モードがないため、`SELECT *` または `SELECT variant_col` はすべての subcolumn から JSON を再構築する必要があり、幅の広い列では非常にコストが高くなります。
- **クエリが型に依存する場合は、常にサブパスを CAST してください。** 型推論は期待と一致しない場合があります。`v['id']` が実際には STRING として保存されているが整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### Operations Phase

- **コンパクション圧力を監視してください。** サブカラムの増加はマージコストを増大させます。Compaction Score が上昇し続ける場合、`variant_max_subcolumns_count` が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視してください。** JSON 構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。重要なパスは Schema Template でロックしてください。
- **型競合を監視してください。** 同じパス上での頻繁な型競合は、JSONB 昇格とインデックス損失を避けるために Schema Template でパスをロックする必要があることを示しています。

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
