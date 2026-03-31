---
{
  "title": "VARIANTワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xでVARIANTを使用するタイミング、sparse columnsを有効にするタイミング、およびSchema TemplateやPath固有のインデックスを追加するタイミングの判断ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

このガイドは、Doris 3.xで新しい`VARIANT`ワークロードを計画する際に使用してください。以下のような疑問への回答に役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが幅広くなっている場合、デフォルトの動作を維持すべきか、それともスパースカラムを有効にすべきか？
- いつSchema Templateやパス固有のインデックスを追加すべきか？

既に`VARIANT`を使用することが決まっていて、構文や型のルールのみが必要な場合は、[VARIANT](./VARIANT)にアクセスしてください。最小限の実行可能なインポートの例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)にアクセスしてください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisが頻繁に使用されるパスにSubcolumnizationを適用することを可能にします。Doris 3.1以降では、幅広いJSONは、ホットパスをSubcolumnizationに保ちながら、ロングテールパスをスパースストレージに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.x機能境界
このガイドは、Doris 3.xで利用可能な機能のみをカバーしています。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、およびパス固有のインデックスは、Doris 3.1.0以降が必要です。新しいバージョンのDOCモードガイダンスは、Doris 3.xには適用されません。
:::

## VARIANTが適する場合

以下のすべてまたはほとんどが当てはまる場合に`VARIANT`を使用してください：

- 入力がJSONまたは時間とともにフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- カラム分析のパフォーマンスを諦めることなく、スキーマの柔軟性が欲しい。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままで良い。

以下の条件が支配的な場合は、静的カラムを優先してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件が、パス別の分析ではなく、生のJSONをアーカイブすることや文書全体を頻繁に返すことである。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム形式のサブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template (3.1+)。** 選択されたパスを安定した型に固定する`VARIANT`カラムの宣言。型付け、インデックス付け、予測可能である必要がある主要なビジネスフィールドに使用します。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 個別パスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始する場合、wide-JSONの問題があります。

**スパースカラム (3.1+)。** 幅広いJSONに明確なホット/コールドの分割がある場合、スパースカラムはホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するために`variant_max_subcolumns_count`を使用します。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム形式のサブカラムとして残り、何千ものロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

## 推奨決定パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリが文書全体を返す幅広いJSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択ではありません。非常に幅広いカラムで`SELECT variant_col`を主なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト設定が既に適切な開始点です。アクセスパターンが明らかに異常な場合にのみ調整してください。典型的な例には、AIトレーニング機能ペイロード、コネクテッドビークルテレメトリ、Doris 3.1以降で異常に大規模なSubcolumnizationと多くのパスレベルインデックスが必要なユーザータグシステムが含まれます。

## ストレージモード

開始点を選ぶために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | デフォルトVARIANT | デフォルトを維持 |
| **B** | 広告 / テレメトリ / ユーザープロファイル（幅広く、ホットパスが少ない） | スパース (3.1+) | `variant_max_subcolumns_count` |
| **C** | 注文 / 決済 / デバイス（主要パスに安定した型が必要） | Schema Template (3.1+) + A または B | 主要パスのみを定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリが馴染みのある少数のパスに繰り返し触れるイベントログや監査ペイロード。

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
ワークロードが sparse columns を正当化するのに十分広いかどうかまだ確信が持てず、ほとんどの価値が依然として複数の共通パスでのフィルタリング、集計、グループ化から得られる場合に使用します。

注意点：
- パスの増加が既に負荷を引き起こしている場合でない限り、`variant_max_subcolumns_count` を早期に上げないでください。
- JSON が広くない場合、sparse columns を有効にすると利益なく複雑性が増します。

### Sparse Mode

> このテンプレートには Doris 3.1.0 以降が必要です。

ペイロードが広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は sparse columns を選択します。

典型例：数千のオプション属性を持ちながら、定期的にクエリされるのは数十のみの広告、テレメトリ、またはプロファイル JSON。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、およびインデックス作成である場合に使用します。

注意点:
- ホットパス分析がボトルネックである場合、sparse columnsが3.xでの正しい方向性です。
- すべてのパスが実質的にSubcolumnizationを通るほど`variant_max_subcolumns_count`を大きく設定しないでください。それは目的に反し、メタデータとcompactionのコストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスが安定した型、安定した動作、またはパス固有のインデックスを必要とする場合にSchema Templateを選択します。

典型例：注文、支払い、またはデバイスペイロードで、少数のビジネスクリティカルなパスが型付けされ検索可能である必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスにより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合は、Schema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON schema全体を静的テンプレートにしないでください。これは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的なままにしてください。

## Performance

以下のチャートは、10Kパスのワイドカラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| Mode | Query Time | Peak Memory |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

重要なポイント：

- **VARIANT Defaultが最高速です。** 76 ms — JSONBより12倍、生のSTRINGより80倍高速。
- **JSONBとSTRINGはメモリを大量消費します。** VARIANTの1 MiBに対し、32-48 GiBのピークメモリを消費します。

## Best Practices

### Import Phase

- **Schema Templateで主要パスを早期に固定してください（3.1+）。** Schema Templateがない場合、システムは自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状に応じて調整してください。** ほとんどのワークロードでは、デフォルトで十分です。AI学習、コネクテッドカー、ユーザータグシステムなど、Doris 3.1以降で異常に大きなSubcolumnizationスケールと多くのパスレベルインデックスが必要なワークロードのシナリオでのみ調整してください。1日目に過度に設定すること（非常に大きな`variant_max_subcolumns_count`）は、利益の証拠なしに複雑さを追加します。

### Query Phase

- **非常にワイドな`VARIANT`カラムでは`SELECT *`をメインクエリパターンとして使用しないでください。** Doris 3.xにはDOCモードがないため、`SELECT *`や`SELECT variant_col`はすべてのサブカラムからJSONを再構築する必要があり、ワイドカラムでは非常に高コストです。
- **クエリが型に依存する場合は、常にサブパスをCASTしてください。** 型推論が期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているが、整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### Operations Phase

- **コンパクション圧力を監視してください。** サブカラムの増加によりマージコストが増加します。Compaction Scoreが上昇し続ける場合は、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視してください。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視してください。** 同じパスでの頻繁な型競合は、JSONBプロモーションとインデックス損失を避けるためにSchema Templateでパスをロックすべきことを示しています。

## Quick Verify

テーブルを作成した後、すべてが機能することを確認するために、この最小限のシーケンスを使用してください：

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
