---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xでVARIANTを使用するタイミング、sparse columnsを有効化するタイミング、およびSchema TemplateやPath固有のインデックスを追加するタイミングの判断ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにサブカラム化を使用します。

このガイドはDoris 3.xで新しい`VARIANT`ワークロードを計画している際に使用してください。以下のような質問に答える助けとなります：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが幅広くなっている場合、デフォルトの動作のままにすべきか、それともスパースカラムを有効にすべきか？
- いつSchema Templateやパス固有のインデックスを追加すべきか？

すでに`VARIANT`を使用したいことが分かっていて、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、Dorisが頻繁に使用されるパスにサブカラム化を適用できるようにします。Doris 3.1以降では、幅広いJSONでホットパスをサブカラム化に保ちながら、ロングテールパスをスパースストレージに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.x機能範囲
このガイドはDoris 3.xで利用可能な機能のみをカバーしています。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、およびパス固有のインデックスにはDoris 3.1.0以降が必要です。新しいバージョンからのDOCモードガイダンスはDoris 3.xには適用されません。
:::

## VARIANTが適している場合

以下の条件のすべてまたはほとんどが当てはまる場合は`VARIANT`を使用してください：

- 入力がJSONまたは時間の経過とともにフィールドが進化する他の半構造化ペイロードである。
- クエリは通常、各行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- カラム分析パフォーマンスを諦めることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要で、他の多くのパスは動的なままで構わない。

以下の条件が優勢な場合は静的カラムを選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別の分析ではなく、生のJSONをアーカイブしたり、文書全体を頻繁に返すことである。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**サブカラム化。** データが`VARIANT`カラムに書き込まれる際、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![デフォルトVARIANT：自動サブカラム抽出](/images/variant/variant-default-storage.png)

**Schema Template（3.1+）。** 選択されたパスを安定した型に固定する`VARIANT`カラム上の宣言です。型付きで、インデックス可能で、予測可能である必要がある主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**幅広いJSON。** 異なるパスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始する場合、幅広いJSONの問題があります。

**スパースカラム（3.1+）。** 幅広いJSONに明確なホット/コールドの分割がある場合、スパースカラムはホットパスをサブカラム化に保ちながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するには`variant_max_subcolumns_count`を使用してください。

![スパースカラム：ホット/コールドパス分離](/images/variant/variant-sparse-storage.png)

上記に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度で独立したカラム型サブカラムとして残り、何千ものロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

## 推奨決定パス

![VARIANT モード決定パス（Doris 3.x）](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリが文書全体を返す幅広いJSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択肢ではありません。非常に幅広いカラムで`SELECT variant_col`を主要なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルトの設定がすでに適切な開始点です。アクセスパターンが明らかに異常な場合にのみ調整してください。典型的な例には、AIトレーニング機能ペイロード、コネクテッドビークルテレメトリ、およびDoris 3.1以降で異常に大規模なサブカラム化と多くのパスレベルインデックスが必要なユーザータグシステムが含まれます。

## ストレージモード

開始点を選択するには以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | デフォルトVARIANT | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパスは少数） | スパース（3.1+） | `variant_max_subcolumns_count` |
| **C** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template（3.1+） + AまたはB | キーパスのみを定義 |

### デフォルトモード

これはほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリが少数の馴染みのあるパスに繰り返し触れるイベントログまたは監査ペイロード。

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
ワークロードが sparse columns を正当化するほど広範囲かどうかまだ確信が持てず、大部分の価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用します。

注意点:
- パスの増加が既に負荷を引き起こしている場合を除き、早期に `variant_max_subcolumns_count` を上げないでください。
- JSONが広範囲でない場合、sparse columns を有効にすることは利益なしに複雑性を追加します。

### Sparse Mode

> このテンプレートには Doris 3.1.0 以降が必要です。

ペイロードが広範囲だが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合に sparse columns を選択します。

典型的な例：数千のオプション属性を持つが定期的にクエリされるのは数十のみの広告、テレメトリ、またはプロファイル JSON。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集計、およびインデックス作成である場合に使用します。

注意点：
- ホットパス分析がボトルネックの場合、sparse columnsが3.xでの正しい方向性です。
- `variant_max_subcolumns_count`を大きく設定しすぎて、事実上すべてのパスがSubcolumnizationを通るようにしないでください。それは目的に反し、メタデータとcompactionコストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択します。

典型的な例：注文、決済、またはデバイスペイロードで、いくつかのビジネスクリティカルなパスが型付けされ検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数のみで、それらのパスでより厳密な型指定やパスレベルのインデックス戦略が必要な場合に使用してください。適切な場合は、Schema Templateをスパース列またはデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON schema全体を静的テンプレートにしないでください。これでは`VARIANT`の意味がありません。
- Schema Templateは主要なパスのみをカバーし、残りは動的なままにしてください。

## パフォーマンス

以下のチャートは、10Kパス幅のワイドカラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| モード | クエリ時間 | ピークメモリ |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

主なポイント：

- **VARIANT Defaultが最速。** 76 ms — JSONBより12倍、raw STRINGより80倍高速。
- **JSONBとSTRINGはメモリを大量消費。** VARIANTの1 MiBに対して、32～48 GiBのピークメモリを消費。

## ベストプラクティス

### インポートフェーズ

- **Schema Templateで主要パスを早期に固定（3.1+）。** Schema Templateがない場合、システムは自動的に型を推論します。同一パスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整。** ほとんどのワークロードでは、デフォルトで十分です。AI訓練、コネクテッドビークル、ユーザータグシステムなどのワークロードで、Doris 3.1以降において異常に大きなSubcolumnizationスケールと多くのパスレベルインデックスが必要な場合のみ、シナリオに応じて調整してください。初日での過度な設定（非常に大きな`variant_max_subcolumns_count`）は、効果の証拠なしに複雑さを追加します。

### クエリフェーズ

- **非常に幅広い`VARIANT`列に対してメインクエリパターンとして`SELECT *`を使用しないでください。** Doris 3.xではDOCモードがないため、`SELECT *`または`SELECT variant_col`はすべてのサブカラムからJSONを再構築する必要があり、幅広い列では非常に高コストです。
- **クエリが型に依存する場合は、常にサブパスをCASTしてください。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして保存されているが整数リテラルと比較する場合、インデックスは使用されず結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視。** サブカラムの増加はマージコストを増大させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、インジェスト率が速すぎるかを確認してください。
- **スキーマドリフトを監視。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージに押しやられ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視。** 同一パスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにSchema Templateでパスをロックすべきことを示しています。

## クイック検証

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
