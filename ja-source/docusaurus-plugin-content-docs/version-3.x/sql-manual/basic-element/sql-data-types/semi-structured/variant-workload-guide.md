---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xでVARIANTを使用するタイミング、sparse columnsを有効化するタイミング、Schema TemplateやPath固有のインデックスを追加するタイミングの判断ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを保存し、頻繁に使用されるパスにSubcolumnizationを使用します。

このガイドは、Doris 3.xで新しい`VARIANT`ワークロードを計画している際に使用してください。以下のような疑問の解決に役立ちます：

- このワークロードは`VARIANT`と静的カラムのどちらを使用すべきか？
- JSONが幅広い場合、デフォルトの動作を維持すべきか、スパースカラムを有効にすべきか？
- いつSchema Templateやパス固有のインデックスを追加すべきか？

`VARIANT`を使用することが既に決定済みで、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、DorisがSubcolumnizationを頻繁に使用されるパスに適用することを可能にします。Doris 3.1以降では、幅広いJSONでもホットパスをSubcolumnizationで保持しつつ、ロングテールパスをスパースストレージに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.x機能の境界
このガイドはDoris 3.xで利用可能な機能のみをカバーします。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、パス固有のインデックスには、Doris 3.1.0以降が必要です。新しいバージョンのDOCモードガイダンスは、Doris 3.xには適用されません。
:::

## VARIANTが適用される場面

以下のすべてまたは大部分が当てはまる場合に`VARIANT`を使用してください：

- 入力がJSONまたは時間の経過とともにフィールドが変化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- カラム型分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままで良い。

以下の条件が支配的な場合は、静的カラムを優先してください：

- スキーマが安定しており、事前に既知である。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件が、パス別の分析ではなく、生のJSONのアーカイブまたはドキュメント全体の頻繁な返却である。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。各用語は2-3行で説明されており、実装の詳細については[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template（3.1+）。** `VARIANT`カラム上の宣言で、選択されたパスを安定した型に固定します。型付き、インデックス可能、予測可能である必要がある主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 個別のパス数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を引き起こし始めた場合、wide-JSONの問題があります。

**スパースカラム（3.1+）。** 幅広いJSONに明確なホット/コールドの分割がある場合、スパースカラムはホットパスをSubcolumnizationで保持しながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するには`variant_max_subcolumns_count`を使用してください。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示されているように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして保持され、数千のロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

## 推奨決定パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリがドキュメント全体を返すwide JSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択ではありません。非常に幅広いカラムで`SELECT variant_col`を主要なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト設定が既に適切な開始点です。アクセスパターンが明らかに異常な場合にのみ調整してください。典型的な例には、AIトレーニング機能ペイロード、コネクテッドビークルテレメトリ、Doris 3.1以降で異常に大規模なSubcolumnizationと多くのパスレベルインデックスを必要とするユーザータグシステムが含まれます。

## ストレージモード

以下のテーブルを使用して開始点を選択し、対応するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT | デフォルト設定を保持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広く、ホットパスが少ない） | Sparse（3.1+） | `variant_max_subcolumns_count` |
| **C** | 注文/決済/デバイス（キーパスに安定した型が必要） | Schema Template（3.1+） + AまたはB | キーパスのみを定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型例：クエリが繰り返し少数の馴染みのあるパスにアクセスするイベントログまたは監査ペイロード。

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
ワークロードが sparse columns を正当化するのに十分な幅があるかどうかまだ確信がなく、主な価値が複数の共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点：
- パスの増大が既に圧迫を引き起こしている場合を除き、早期に `variant_max_subcolumns_count` を上げないでください。
- JSONが広くない場合、sparse columns を有効にすると利益なしに複雑さが増します。

### Sparse Mode

> このテンプレートには Doris 3.1.0 以降が必要です。

ペイロードが広いが、ほとんどのクエリが少数のホットパスに焦点を当てている場合は sparse columns を選択してください。

典型的な例：数千のオプション属性を持つが、定期的にクエリされるのは数十個のみの広告、テレメトリ、またはプロファイル JSON。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、およびインデックス化である場合に使用してください。

注意点:
- ホットパス分析がボトルネックの場合、sparse columnsが3.xでの正しい方向性です。
- すべてのパスが実質的にSubcolumnizationを通るほど`variant_max_subcolumns_count`を大きく設定しないでください。これは目的を損ない、メタデータとcompactionコストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択してください。

典型的な例: 注文、支払い、またはデバイスペイロードで、いくつかのビジネスクリティカルなパスが型付きで検索可能な状態を維持する必要がある場合。

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
少数のフィールドのみがビジネスクリティカルで、それらのパスにより厳密な型付けまたはパスレベルのインデックス戦略が必要な場合に使用します。適切な場合は、Schema Templateをスパース列またはデフォルトの`VARIANT`と組み合わせます。

注意点:
- JSON スキーマ全体を静的テンプレートに変換しないでください。それでは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的なままにしておく必要があります。

## Performance

以下のチャートは、10K パス幅のワイドカラムデータセット（200K 行、1 つのキーを抽出、16 CPU、3 回実行の中央値）における単一パス抽出時間を比較しています。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| Mode | Query Time | Peak Memory |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

主なポイント:

- **VARIANT Default が最高速です。** 76 ms — JSONB より 12 倍高速、生の STRING より 80 倍高速です。
- **JSONB と STRING はメモリを大量消費します。** VARIANT の 1 MiB に対して、32–48 GiB のピークメモリを消費します。

## Best Practices

### Import Phase

- **Schema Template を使用して主要パスを早期に固定してください（3.1+）。** Schema Template がない場合、システムは自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列へ）、JSONB に昇格され、そのパス上のインデックスが失われます。
- **デフォルト設定から開始し、症状に基づいて調整してください。** ほとんどのワークロードでは、デフォルトで十分です。AI トレーニング、コネクテッドカー、ユーザータグシステムなどのワークロードで、異常に大きな Subcolumnization スケールと Doris 3.1 以降での多数のパスレベルインデックスが必要な場合のみ、シナリオ別に調整してください。初日からの過度な設定（非常に大きな`variant_max_subcolumns_count`）は、利益の根拠なしに複雑さを追加します。

### Query Phase

- **非常に幅の広い`VARIANT`列に対するメインクエリパターンとして`SELECT *`を使用しないでください。** Doris 3.x には DOC モードがないため、`SELECT *`または`SELECT variant_col`はすべてのサブカラムから JSON を再構築する必要があり、幅の広い列では非常にコストが高くなります。
- **クエリが型に依存する場合は、常にサブパスを CAST してください。** 型推論は期待通りにならない場合があります。`v['id']`が実際には STRING として保存されているが整数リテラルと比較する場合、インデックスが使用されず、結果が間違っている可能性があります。

### Operations Phase

- **コンパクション圧迫を監視してください。** サブカラムの増加はマージコストを増加させます。Compaction Score が上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **スキーマドリフトを監視してください。** JSON 構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Template で重要なパスをロックしてください。
- **型競合を監視してください。** 同じパスでの頻繁な型競合は、JSONB 昇格とインデックス損失を避けるために Schema Template でそのパスをロックすべきであることを示しています。

## Quick Verify

テーブル作成後、すべてが正常に動作することを確認するために、この最小限のシーケンスを使用してください:

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
