---
{
  "title": "VARIANTワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xにおけるVARIANTの使用時期、sparse columnsの有効化時期、およびSchema TemplateやPath固有のindexesの追加時期に関する判断ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

このガイドは、Doris 3.xで新しい`VARIANT`ワークロードを計画する際に使用してください。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが幅広くなる場合、デフォルトの動作を維持すべきか、それともスパースカラムを有効にすべきか？
- いつSchema Templateやパス固有のインデックスを追加すべきか？

既に`VARIANT`を使いたいことが決まっていて、構文や型の規則のみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、DorisがSubcolumnizationを頻繁に使用されるパスに適用できるようにします。Doris 3.1以降では、幅広いJSONがホットパスをSubcolumnizationに保ちながら、ロングテールパスをスパースストレージに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.xの機能境界
このガイドはDoris 3.xで利用可能な機能のみをカバーします。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、パス固有のインデックスにはDoris 3.1.0以降が必要です。新しいバージョンのDOCモードガイダンスはDoris 3.xには適用されません。
:::

## VARIANTが適している場合

以下のすべてまたは大部分が当てはまる場合に`VARIANT`を使用してください：

- 入力がJSONまたはフィールドが時間とともに進化するその他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- カラム分析パフォーマンスを犠牲にすることなく、スキーマの柔軟性が欲しい。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が支配的な場合は、静的カラムを優先してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主要な要件がパス別の分析ではなく、生のJSONをアーカイブしたり、文書全体を頻繁に返すことである。

## キーコンセプト

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2～3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template (3.1+)。** `VARIANT`カラムに対する宣言で、選択されたパスを安定した型に固定します。型付きで、インデックス可能で、予測可能な状態を維持する必要があるキービジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増え続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストが増加し始めるときに、wide-JSONの問題があります。

**Sparse columns (3.1+)。** 幅広いJSONに明確なホット/コールド分割がある場合、スパースカラムはホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するために`variant_max_subcolumns_count`を使用してください。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして残り、数千のロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

## 推奨決定パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリが文書全体を返すwide JSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択ではありません。非常に幅広いカラムで`SELECT variant_col`を主なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト設定が既に適切な開始点です。アクセスパターンが明らかに異常な場合にのみ調整してください。典型的な例には、AIトレーニング機能ペイロード、コネクテッドビークルテレメトリ、Doris 3.1以降で異常に大規模なSubcolumnizationと多くのパスレベルインデックスを必要とするユーザータグシステムが含まれます。

## ストレージモード

開始点を選ぶために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | キー設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパスが少ない） | Sparse (3.1+) | `variant_max_subcolumns_count` |
| **C** | 注文/支払い/デバイス（キーパスが安定した型を必要とする） | Schema Template (3.1+) + AまたはB | キーパスのみを定義 |

### デフォルトモード

これはほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

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
ワークロードが sparse columns を正当化するのに十分広いかどうかまだ確信がなく、大部分の価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点:
- パスの増加が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count` を早期に上げないでください。
- JSON が広くない場合、sparse columns を有効にすると利益なしに複雑性が増します。

### Sparse Mode

> このテンプレートには Doris 3.1.0 以降が必要です。

ペイロードが広いが、大部分のクエリが依然として少数のホットパスに焦点を当てている場合に sparse columns を選択してください。

典型例: 数千のオプション属性を持つが、定期的にクエリされるのは数十のみの広告、テレメトリ、またはプロファイル JSON。

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
- 実質的にすべてのパスがSubcolumnizationを通るほど`variant_max_subcolumns_count`を大きく設定しないでください。それは目的を損ない、メタデータとcompactionコストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスが安定した型、安定した動作、またはパス固有のインデックスを必要とする場合にSchema Templateを選択してください。

典型例：注文、支払い、またはデバイスペイロードにおいて、少数のビジネスクリティカルなパスが型付けされ検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。適切な場合は、Schema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON スキーマ全体を静的テンプレートにしないでください。これは`VARIANT`の意味を無効にします。
- Schema Template は重要なパスのみをカバーし、残りは動的に保つ必要があります。

## パフォーマンス

以下のチャートは、10Kパスのワイドカラムデータセット（20万行、1つのキーを抽出、16 CPU、3回実行の中央値）でのシングルパス抽出時間を比較したものです。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| モード | クエリ時間 | ピークメモリ |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

重要なポイント：

- **VARIANT Defaultが最速。** 76 ms — JSONBより12倍、生のSTRINGより80倍高速。
- **JSONBとSTRINGはメモリを大量消費。** VARIANTの1 MiBに対し、32-48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **Schema Templateで重要パスを早期に固定（3.1+）。** Schema Templateがない場合、システムは自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状から調整。** ほとんどのワークロードでは、デフォルトで十分です。AI学習、コネクテッドカー、ユーザータグシステムなどのワークロードが、Doris 3.1以降で異常に大きなSubcolumnizationスケールと多くのパスレベルインデックスを必要とする場合のみ、シナリオ別に調整してください。初日からの過剰設定（非常に大きな`variant_max_subcolumns_count`）は、利益の証拠なしに複雑性を追加します。

### クエリフェーズ

- **非常に幅広い`VARIANT`カラムで`SELECT *`をメインクエリパターンとして使用しない。** Doris 3.xにはDOCモードがないため、`SELECT *`や`SELECT variant_col`はすべてのサブカラムからJSONを再構築する必要があり、ワイドカラムでは非常に高コストです。
- **クエリが型に依存する場合は常にサブパスをCAST。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視。** サブカラムの増大はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視。** JSON構造が頻繁に変わる場合、ホットパスがスパースストレージに押し込まれ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要パスをロックしてください。
- **型競合を監視。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにそのパスをSchema Templateでロックすべきことを示しています。

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
