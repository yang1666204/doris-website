---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xにおけるVARIANTの使用時期、sparse columnsの有効化時期、およびSchema TemplateやPath固有のインデックスの追加時期に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスでSubcolumnizationを使用します。

このガイドは、Doris 3.xで新しい`VARIANT`ワークロードを計画する際に使用してください。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`と静的カラムのどちらを使用すべきか？
- JSONが幅広くなる場合、デフォルトの動作を維持すべきか、それともスパースカラムを有効にすべきか？
- いつSchema Templateやパス固有のインデックスを追加すべきか？

`VARIANT`を使用したいことが既に分かっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選択する理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisが頻繁に使用されるパスにSubcolumnizationを適用できます。Doris 3.1以降では、幅広いJSONがホットパスをSubcolumnizationに保持し、ロングテールパスをスパースストレージに移動できるため、事前にすべてのフィールドを固定する必要がありません。
:::

:::note 3.x機能境界
このガイドはDoris 3.xで利用可能な機能のみをカバーしています。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、パス固有のインデックスはDoris 3.1.0以降が必要です。新しいバージョンのDOCモードガイダンスはDoris 3.xには適用されません。
:::

## VARIANTが適合する場面

以下のすべてまたは大部分が当てはまる場合は`VARIANT`を使用してください：

- 入力がJSONまたは時間と共にフィールドが進化するその他の半構造化ペイロードである
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる
- カラム型分析のパフォーマンスを諦めることなくスキーマの柔軟性が欲しい
- 一部のパスではインデックスが必要だが、他の多くのパスは動的なままでよい

以下の条件が優勢な場合は静的カラムを優先してください：

- スキーマが安定していて事前に分かっている
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される
- 主な要件がパス別の分析ではなく、生のJSONをアーカイブするか、文書全体を頻繁に返すことである

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template (3.1+)。** 選択されたパスを安定した型に固定する`VARIANT`カラムの宣言。型付け、インデックス化、予測可能性が必要な主要なビジネスフィールドに使用します。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始するときに、wide-JSONの問題があります。

**スパースカラム (3.1+)。** 幅広いJSONに明確なホット/コールドの分割がある場合、スパースカラムはホットパスをSubcolumnizationに保持しながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するには`variant_max_subcolumns_count`を使用します。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度で独立したカラム型サブカラムとして残り、数千のロングテールパスは共有スパースストレージに集約されます。閾値は`variant_max_subcolumns_count`によって制御されます。

## 推奨決定パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリが文書全体を返す幅広いJSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択ではありません。非常に幅広いカラムで`SELECT variant_col`を主なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト設定が既に適切な開始点です。アクセスパターンが明らかに異常な場合にのみチューニングしてください。典型的な例には、AI訓練の特徴ペイロード、コネクテッドビークルのテレメトリ、Doris 3.1以降で異常に大規模なSubcolumnizationと多くのパスレベルインデックスが必要なユーザータグシステムが含まれます。

## ストレージモード

以下の表を使用して開始点を選択し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT | デフォルトを維持 |
| **B** | 広告 / テレメトリ / ユーザープロファイル（幅広い、ホットパスは少数） | Sparse (3.1+) | `variant_max_subcolumns_count` |
| **C** | 注文 / 支払い / デバイス（キーパスに安定した型が必要） | Schema Template (3.1+) + AまたはB | キーパスのみ定義 |

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
    "replication_num" = "1"
);
```
ワークロードが sparse columns を正当化するのに十分広いかどうかまだ確信が持てず、ほとんどの価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点:
- パスの増加が既に負荷を引き起こしている場合を除き、早期に `variant_max_subcolumns_count` を上げないでください。
- JSONが広くない場合、sparse columns を有効にすると利益なしに複雑性が増します。

### Sparse Mode

> このテンプレートには Doris 3.1.0 以降が必要です。

ペイロードが広いが、ほとんどのクエリが小さなホットパスのセットに焦点を当てている場合は sparse columns を選択してください。

典型的な例: 数千のオプション属性を持つが、定期的にクエリされるのは数十のみの広告、テレメトリ、またはプロファイル JSON。

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
主要なワークロードがパスベースのフィルタリング、集約、インデックス処理であるものの、キーの総数が非常に大きい場合に使用してください。

注意点:
- ホットパス分析がボトルネックの場合、sparse columnsが3.xでの正しい方向性です。
- `variant_max_subcolumns_count`を大きく設定しすぎて、事実上すべてのパスがSubcolumnizationを通るようにしないでください。これは目的に反し、メタデータと compaction のコストが増加します。

### Schema Template

> このテンプレートにはDoris 3.1.0以降が必要です。

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択してください。

典型的な例: 注文、支払い、デバイスのペイロードで、ビジネスクリティカルな少数のパスが型付けされ検索可能である必要がある場合。

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
ビジネスクリティカルなフィールドが少数のみで、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。適切な場合は、Schema Templateをsparse columnsやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON schema全体を静的テンプレートにしないでください。これは`VARIANT`の意味を損ないます。
- Schema Templateは重要なパスのみをカバーし、残りは動的のままにしてください。

## パフォーマンス

以下のチャートは、10K-path wide-columnデータセット（200K行、1キー抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| Mode | Query Time | Peak Memory |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

主要なポイント：

- **VARIANT Defaultが最速。** 76 ms — JSONBより12倍、raw STRINGより80倍高速。
- **JSONBとSTRINGはメモリ使用量が多い。** VARIANTの1 MiBに対して、32-48 GiBのピークメモリを消費。

## ベストプラクティス

### インポート段階

- **Schema Templateで重要なパスを早期に固定する（3.1+）。** Schema Templateなしでは、システムは自動的に型を推論します。同じパスでバッチ間で型が変更された場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状から調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI訓練、コネクテッドカー、ユーザータグシステムなどのワークロードで、Doris 3.1以降で異常に大きなSubcolumnization規模と多くのパスレベルインデックスが必要な場合のみ、シナリオ別に調整してください。初日からの過剰設定（非常に大きな`variant_max_subcolumns_count`）は、利益の証拠なしに複雑さを追加します。

### クエリ段階

- **非常に幅広い`VARIANT`カラムに対して`SELECT *`をメインクエリパターンとして使用しない。** Doris 3.xにはDOCモードがないため、`SELECT *`や`SELECT variant_col`はすべてのsubcolumnからJSONを再構成する必要があり、幅広いカラムでは非常に高コストです。
- **クエリが型に依存する場合は、常にサブパスをCASTする。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして保存されているが整数リテラルと比較する場合、インデックスは使用されず、結果が間違っている可能性があります。

### 運用段階

- **コンパクション圧力を監視する。** サブカラムの増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更される場合、ホットパスがsparse storageにプッシュされ、突然のクエリ性能低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視する。** 同じパスでの頻繁な型競合は、そのパスがSchema Templateでロックされ、JSONB昇格とインデックス損失を回避する必要があることを示しています。

## 簡単な検証

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
