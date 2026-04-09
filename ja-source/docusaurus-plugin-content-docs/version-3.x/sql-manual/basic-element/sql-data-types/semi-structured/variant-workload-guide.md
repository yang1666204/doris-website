---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xでVARIANTを使用するタイミング、sparse columnsを有効にするタイミング、およびSchema TemplateやPath固有のインデックスを追加するタイミングの判断ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを保存し、頻繁に使用されるパスでSubcolumnizationを使用します。

このガイドは、Doris 3.xで新しい`VARIANT`ワークロードを計画する際に使用してください。以下のような質問に答えるのに役立ちます：

- このワークロードで`VARIANT`を使うべきか、それとも静的カラムを使うべきか？
- JSONが横に広くなる場合、デフォルト動作のままにするか、それともsparseカラムを有効にするべきか？
- いつSchema Templateやパス固有のインデックスを追加すべきか？

既に`VARIANT`を使いたいことが決まっていて、構文や型のルールのみが必要な場合は、[VARIANT](./VARIANT)に進んでください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)に進んでください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONを柔軟に保ちながら、Dorisが頻繁に使用されるパスにSubcolumnizationを適用できるようにします。Doris 3.1以降では、幅広いJSONでホットパスをSubcolumnizationで保持し、ロングテールパスをsparse storageに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.x機能境界
このガイドはDoris 3.xで利用可能な機能のみをカバーしています。Sparseカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、およびパス固有のインデックスはDoris 3.1.0以降が必要です。新しいバージョンのDOCモードガイダンスはDoris 3.xには適用されません。
:::

## VARIANTが適している場合

以下のすべてまたは大部分が該当する場合に`VARIANT`を使用してください：

- 入力がJSONまたは時間とともにフィールドが進化する他の半構造化ペイロードである
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる
- 列指向分析パフォーマンスを諦めることなく、スキーマの柔軟性が必要
- 一部のパスにはインデックスが必要だが、その他の多くのパスは動的なままでよい

以下の条件が優勢な場合は静的カラムを選択してください：

- スキーマが安定しており、事前に分かっている
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される
- 主な要件がパスによる分析ではなく、生のJSONのアーカイブや文書全体の頻繁な返却である

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立した列指向サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template（3.1+）。** 選択されたパスを安定した型に固定する`VARIANT`カラムの宣言。型付け、インデックス化、予測可能である必要がある主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始する場合、wide-JSON問題があります。

**Sparseカラム（3.1+）。** 幅広いJSONに明確なホット/コールドの分割がある場合、sparseカラムはホットパスをSubcolumnizationで保持し、コールド（ロングテール）パスを共有sparse storageにプッシュします。境界を制御するには`variant_max_subcolumns_count`を使用してください。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上記に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立した列指向サブカラムとして残り、数千のロングテールパスは共有sparse storageに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

## 推奨判断パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリが文書全体を返すwide JSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択ではありません。非常に幅広いカラムで`SELECT variant_col`を主要なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト設定が既に適切な出発点です。アクセスパターンが明らかに異常な場合にのみチューニングしてください。典型的な例には、AIトレーニング機能ペイロード、コネクテッドビークルテレメトリ、およびDoris 3.1以降で異常に大規模なSubcolumnizationと多くのパスレベルインデックスを必要とするユーザータグシステムが含まれます。

## ストレージモード

出発点を選ぶために以下の表を使用し、対応するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | デフォルトVARIANT | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広く、ホットパスは少数） | Sparse（3.1+） | `variant_max_subcolumns_count` |
| **C** | 注文/支払い/デバイス（主要パスに安定した型が必要） | Schema Template（3.1+） + AまたはB | 主要パスのみを定義 |

### デフォルトモード

これはほとんどの新しい`VARIANT`ワークロードにとって最も安全な出発点です。

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
ワークロードが sparse columns を正当化するのに十分な幅があるかどうかまだ確信が持てず、フィルタリング、集約、および複数の共通パスでのグループ化から大部分の価値が得られる場合に使用してください。

注意点：
- パスの増大が既に負荷を引き起こしていない限り、早期に `variant_max_subcolumns_count` を上げないでください。
- JSONが幅広くない場合、sparse columns を有効にすると利益なしに複雑性が増します。

### Sparse Mode

> このテンプレートは Doris 3.1.0 以降が必要です。

ペイロードが幅広いが、ほとんどのクエリが少数のホットパスに焦点を当てている場合は sparse columns を選択してください。

典型的な例：数千のオプション属性を持つが、定期的にクエリされるのは数十のみの広告、テレメトリ、またはプロファイル JSON。

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
- ホットパス分析がボトルネックの場合、スパース列が3.xでの正しい方向性です。
- `variant_max_subcolumns_count`を大きく設定しすぎて、効果的にすべてのパスがSubcolumnizationを通るようにしてはいけません。これは目的を損ない、メタデータとコンパクション・コストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスが安定した型、安定した動作、またはパス固有のインデックスを必要とする場合にSchema Templateを選択してください。

典型的な例：注文、支払い、またはデバイスペイロードにおいて、いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数のみで、それらのパスにより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。適切な場合はSchema Templateをスパース列やデフォルトの`VARIANT`と組み合わせます。

注意点：
- JSONスキーマ全体を静的テンプレートに変換しないでください。それでは`VARIANT`の意味がありません。
- Schema Templateは重要なパスのみをカバーし、残りは動的のままにします。

## パフォーマンス

以下のチャートは、10Kパスのワイドカラムデータセット（20万行、1つのキーを抽出、16 CPU、3回実行の中央値）でのシングルパス抽出時間を比較しています。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| モード | クエリ時間 | ピークメモリ |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

主なポイント：

- **VARIANT Defaultが最高速。** 76 ms — JSOBより12倍、raw STRINGより80倍高速。
- **JSOBとSTRINGはメモリを大量消費。** VARIANTの1 MiBに対し、32〜48 GiBのピークメモリを消費。

## ベストプラクティス

### インポートフェーズ

- **Schema Templateで重要なパスを早期に固定（3.1+）。** Schema Templateなしでは、システムが自動的に型を推論します。同じパスがバッチ間で型を変更（例：整数から文字列）すると、JSOBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整。** 多くのワークロードでは、デフォルトで十分です。AI訓練、コネクテッドカー、ユーザータグシステムなどのワークロードが異常に大きなSubcolumnization規模やDoris 3.1以降の多数のパスレベルインデックスを必要とする場合のみ、シナリオ別に調整してください。初日から過剰設定（非常に大きな`variant_max_subcolumns_count`）すると、利益の証拠なしに複雑性が増します。

### クエリフェーズ

- **非常に幅の広い`VARIANT`列のメインクエリパターンとして`SELECT *`を使用しない。** Doris 3.xにはDOCモードがないため、`SELECT *`や`SELECT variant_col`はすべてのサブカラムからJSONを再構築する必要があり、幅の広い列では非常に高コストです。
- **クエリが型に依存する場合は常にサブパスをCASTする。** 型推論が期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているが整数リテラルと比較する場合、インデックスが使用されず結果が間違う可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視。** サブカラムの増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるかインジェスト率が速すぎるかを確認してください。
- **スキーマドリフトを監視。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにSchema Templateでパスをロックすべきことを示しています。

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
