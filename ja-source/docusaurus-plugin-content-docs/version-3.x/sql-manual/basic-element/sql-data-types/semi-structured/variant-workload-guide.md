---
{
  "title": "VARIANTワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xにおけるVARIANTを使用するタイミング、sparse columnsを有効にするタイミング、およびSchema TemplateやPath固有のindexを追加するタイミングの決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

このガイドは、Doris 3.xで新しい`VARIANT`ワークロードを計画している際に使用してください。以下のような疑問の解決に役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが幅広くなっている場合、デフォルトの動作を維持すべきか、それともスパースカラムを有効にすべきか？
- いつスキーマテンプレートやパス固有のインデックスを追加すべきか？

すでに`VARIANT`を使用することが決まっていて、構文やタイプルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。実行可能な最小のインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisが頻繁に使用されるパスにSubcolumnizationを適用できるようにします。Doris 3.1以降では、幅広いJSONでもホットパスをSubcolumnizationで維持し、ロングテールパスはスパースストレージに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.x機能境界
このガイドはDoris 3.xで利用可能な機能のみをカバーしています。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、およびパス固有のインデックスには、Doris 3.1.0以降が必要です。新しいバージョンのDOCモードガイダンスは、Doris 3.xには適用されません。
:::

## VARIANTが適している場合

以下のすべて、またはほとんどが当てはまる場合に`VARIANT`を使用してください：

- 入力がJSONまたは時間とともにフィールドが進化するその他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- カラム型分析パフォーマンスを諦めることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままで構わない。

以下の条件が優先される場合は、静的カラムを使用してください：

- スキーマが安定しており、事前に既知である。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別の分析ではなく、生JSONのアーカイブや文書全体の頻繁な返却である。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれる際、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**スキーマテンプレート（3.1+）。** 選択されたパスを安定した型に固定する`VARIANT`カラムに対する宣言です。型付き、インデックス可能、予測可能でなければならない主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**幅広いJSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始する場合、幅広いJSONの問題があります。

**スパースカラム（3.1+）。** 幅広いJSONに明確なホット/コールドの分割がある場合、スパースカラムはホットパスをSubcolumnizationで維持し、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するには`variant_max_subcolumns_count`を使用してください。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして留まり、数千のロングテールパスは共有スパースストレージに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

## 推奨決定パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリが文書全体を返す幅広いJSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択肢ではありません。非常に幅広いカラムで`SELECT variant_col`を主要なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト設定がすでに適切な開始点です。アクセスパターンが明らかに異常な場合のみ調整してください。典型的な例には、AI学習機能ペイロード、コネクテッドビークルテレメトリ、およびDoris 3.1以降で異常に大規模なSubcolumnizationと多くのパスレベルインデックスを必要とするユーザータグシステムが含まれます。

## ストレージモード

開始点を選択するには以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | デフォルトVARIANT | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパスが少ない） | スパース（3.1+） | `variant_max_subcolumns_count` |
| **C** | 注文/支払い/デバイス（主要パスに安定した型が必要） | スキーマテンプレート（3.1+） + AまたはB | 主要パスのみ定義 |

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
ワークロードが sparse columns を正当化するのに十分な広さがあるかまだ確信が持てない場合や、いくつかの一般的なパスでのフィルタリング、集約、グループ化から依然として多くの価値を得ている場合に使用してください。

注意点：
- パスの増加が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count` を早期に上げないでください。
- JSON が広くない場合、sparse columns を有効にすると利益なしに複雑さが増します。

### Sparse Mode

> このテンプレートには Doris 3.1.0 以降が必要です。

ペイロードが広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columns を選択してください。

典型的な例：数千のオプション属性を持つが、定期的にクエリされるのは数十だけの広告、テレメトリ、またはプロファイル JSON。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、インデックス化である場合に使用してください。

注意事項:
- ホットパス分析がボトルネックの場合、sparse columnsが3.xでの正しい方向です。
- すべてのパスが事実上Subcolumnizationを通るほど`variant_max_subcolumns_count`を大きく設定しないでください。それは目的を無効にし、メタデータとcompactionコストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択してください。

典型的な例: いくつかのビジネスクリティカルなパスが型付けされ検索可能な状態を維持する必要がある注文、支払い、またはデバイスペイロード。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型指定やパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合は、Schema TemplateをSparseカラムまたはデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON スキーマ全体を静的テンプレートに変換しないでください。これでは`VARIANT`の意味がなくなります。
- Schema Templateはキーパスのみをカバーし、残りは動的のままにしておくべきです。

## Performance

以下のグラフは、10Kパス幅広カラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較したものです。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| Mode | Query Time | Peak Memory |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

主要なポイント：

- **VARIANT Defaultが最速です。** 76 ms — JSONBより12倍高速、生のSTRINGより80倍高速。
- **JSONBとSTRINGはメモリを大量消費します。** VARIANTの1 MiBに対し、32-48 GiBのピークメモリを消費します。

## Best Practices

### Import Phase

- **Schema Templateでキーパスを早期に固定してください（3.1以降）。** Schema Templateがないと、システムは型を自動的に推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状から調整してください。** ほとんどのワークロードでは、デフォルトで十分です。AIトレーニング、コネクテッドビークル、ユーザータグシステムなどのワークロードで、Doris 3.1以降において異常に大規模なSubcolumnizationスケールと多くのパスレベルインデックスが必要な場合のみ、シナリオ別に調整してください。初日から過度に設定すること（非常に大きな`variant_max_subcolumns_count`）は、利益の証拠なしに複雑さを追加します。

### Query Phase

- **非常に幅広い`VARIANT`カラムのメインクエリパターンとして`SELECT *`を使用しないでください。** Doris 3.xにはDOCモードがないため、`SELECT *`や`SELECT variant_col`はすべてのサブカラムからJSONを再構築する必要があり、幅広いカラムでは非常にコストが高くなります。
- **クエリが型に依存する場合は、常にサブパスをCASTしてください。** 型推論は期待と一致しない場合があります。`v['id']`が実際にSTRINGとして格納されているが整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### Operations Phase

- **compaction圧力を監視してください。** サブカラムの成長はマージコストを増加させます。Compaction Scoreが上昇し続ける場合は、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **スキーマドリフトを監視してください。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、クエリの突然の速度低下を引き起こす可能性があります。Schema Templateで重要なパスを固定してください。
- **型競合を監視してください。** 同じパスで頻繁に型競合が発生する場合は、JSONB昇格とインデックス損失を避けるためSchema Templateでパスを固定すべきことを示しています。

## Quick Verify

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
- [Inverted Index](../../../../table-design/index/inverted-index)
- [Full-Text Search Operators](../../operators/conditional-operators/full-text-search-operators)
