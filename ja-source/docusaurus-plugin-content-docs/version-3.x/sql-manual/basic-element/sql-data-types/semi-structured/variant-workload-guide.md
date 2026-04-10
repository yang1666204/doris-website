---
{
  "title": "VARIANTワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xにおけるVARIANTの使用時期、sparse columnsの有効化時期、およびSchema Templateやpath固有のインデックスの追加時期に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

このガイドは、Doris 3.xで新しい`VARIANT`ワークロードを計画している際に使用してください。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが大きくなっている場合、デフォルト動作を維持すべきか、それともスパースカラムを有効にすべきか？
- いつSchema Templateやパス固有のインデックスを追加すべきか？

既に`VARIANT`を使用することが決まっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip なぜVARIANTを選ぶのか
`VARIANT`はJSONの柔軟性を保ちながら、DorisがSubcolumnizationを頻繁に使用されるパスに適用することを可能にします。Doris 3.1以降では、大きなJSONでもホットパスをSubcolumnizationに保持し、ロングテールパスをスパースストレージに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.x機能境界
このガイドはDoris 3.xで利用可能な機能のみをカバーしています。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、パス固有のインデックスにはDoris 3.1.0以降が必要です。新しいバージョンのDOCモードガイダンスはDoris 3.xには適用されません。
:::

## VARIANTが適している場合

以下のすべてまたはほとんどが当てはまる場合に`VARIANT`を使用してください：

- 入力がJSONまたは時間の経過とともにフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- カラム型分析パフォーマンスを諦めることなく、スキーマの柔軟性が欲しい。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的のままにできる。

以下の条件が主な場合は静的カラムを選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件は生のJSONをアーカイブするか、パスによる分析ではなく文書全体を頻繁に返すことである。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template (3.1+)。** 選択されたパスを安定した型に固定する`VARIANT`カラム上の宣言。型付き、インデックス可能、予測可能でなければならない主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 個別パスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始すると、wide-JSONの問題があります。

**スパースカラム (3.1+)。** wide JSONに明確なホット/コールド分離がある場合、スパースカラムはホットパスをSubcolumnizationに保持しながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するために`variant_max_subcolumns_count`を使用してください。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして残り、数千のロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

## 推奨決定パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリが文書全体を返すwide JSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択ではありません。非常に大きなカラムで`SELECT variant_col`を主なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト設定が既に適切な出発点です。アクセスパターンが明らかに異常な場合にのみチューニングしてください。典型的な例には、AI訓練特徴量ペイロード、コネクテッドビークルテレメトリ、Doris 3.1以降で異常に大規模なSubcolumnizationと多くのパスレベルインデックスが必要なユーザータグシステムが含まれます。

## ストレージモード

出発点を選択するために以下の表を使用し、対応するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（大きく、ホットパスが少ない） | Sparse (3.1+) | `variant_max_subcolumns_count` |
| **C** | 注文/支払い/デバイス（主要パスに安定した型が必要） | Schema Template (3.1+) + AまたはB | 主要パスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な出発点です。

典型例：クエリが少数の馴染みのあるパスに繰り返し触れるイベントログまたは監査ペイロード。

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
ワークロードが sparse columns を正当化するほど幅広いかどうかまだ確信がなく、ほとんどの価値がいくつかの共通パスでのフィルタリング、集約、およびグループ化から得られる場合に使用してください。

注意点：
- パスの増加が既に圧迫を引き起こしている場合を除き、`variant_max_subcolumns_count` を早期に上げないでください。
- JSONが幅広くない場合、sparse columns を有効にすると利益なしに複雑性が増します。

### Sparse Mode

> このテンプレートはDoris 3.1.0以降が必要です。

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は、sparse columns を選択してください。

典型例：数千のオプション属性を持つが、定期的にクエリされるのは数十のみの広告、テレメトリ、またはプロファイルJSON。

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
合計キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、およびインデックス処理である場合に使用します。

注意点:
- ホットパス分析がボトルネックである場合、3.xではsparse columnsが適切な方向性です。
- `variant_max_subcolumns_count`を大きく設定しすぎて、事実上すべてのパスがSubcolumnizationを通るようにしないでください。これは目的に反し、メタデータとcompactionのコストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択してください。

典型例: 注文、支払い、またはデバイスペイロードで、少数のビジネスクリティカルなパスが型付けされ検索可能である必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスにより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。必要に応じてSchema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意事項:
- JSONスキーマ全体を静的テンプレートに変換しないでください。これは`VARIANT`の意味がなくなります。
- Schema Templateは主要パスのみをカバーし、残りは動的のままにしておきます。

## パフォーマンス

下記のチャートは、10K-path幅広カラムデータセット（200K行、1つのキーを抽出、16 CPU、3回の実行の中央値）での単一パス抽出時間を比較しています。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| モード | クエリ時間 | ピークメモリ |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

主なポイント:

- **VARIANT Defaultが最高速です。** 76 ms — JSONBより12倍、raw STRINGより80倍高速です。
- **JSONBとSTRINGはメモリ使用量が多いです。** VARIANTの1 MiBに対し、32-48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **Schema Templateで主要パスを早期に固定します（3.1+）。** Schema Templateなしでは、システムが自動的に型を推論します。同一パスが複数バッチで型が変わる場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始め、症状に応じて調整します。** ほとんどのワークロードでは、デフォルトで十分です。AI学習、コネクテッドカー、ユーザータグシステムなど、Doris 3.1以降で異常に大きなSubcolumnizationスケールと多数のパスレベルインデックスが必要なワークロードでのみ、シナリオ別に調整してください。1日目から過度に設定すること（非常に大きな`variant_max_subcolumns_count`）は、利益の証拠なしに複雑さを追加します。

### クエリフェーズ

- **非常に幅の広い`VARIANT`カラムに対するメインクエリパターンとして`SELECT *`を使用しないでください。** Doris 3.xにはDOCモードがないため、`SELECT *`や`SELECT variant_col`はすべてのサブカラムからJSONを再構築する必要があり、幅広カラムでは非常に高コストになります。
- **クエリが型に依存する場合は、常にサブパスをCASTしてください。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較した場合、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション負荷を監視してください。** サブカラムの増大はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎないかを確認してください。
- **スキーマドリフトを監視してください。** JSON構造が頻繁に変わる場合、ホットパスがスパースストレージにプッシュされ、クエリの突然の速度低下を引き起こす可能性があります。Schema Templateで重要パスをロックしてください。
- **型競合を監視してください。** 同一パスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにSchema Templateでそのパスをロックすべきことを示しています。

## クイック確認

テーブル作成後、すべてが正常に動作することを確認するため、この最小限のシーケンスを使用してください:

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
