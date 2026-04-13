---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xでVARIANTを使用するタイミング、sparse columnsを有効にするタイミング、およびSchema TemplateやPath固有のindexesを追加するタイミングの決定ガイド。"
}
---
## 概要

`VARIANT` は半構造化JSONを保存し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

このガイドはDoris 3.xで新しい`VARIANT`ワークロードを計画している場合に使用してください。以下のような疑問に答えるのに役立ちます：

- このワークロードは`VARIANT`と静的カラムのどちらを使用するべきか？
- JSONが幅広くなっている場合、デフォルトの動作を維持するべきか、スパースカラムを有効にするべきか？
- いつSchema Templateやパス固有のインデックスを追加するべきか？

`VARIANT`を使用することが既に決まっていて、構文や型のルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちながら、DorisがSubcolumnizationを頻繁に使用されるパスに適用できるようにします。Doris 3.1以降では、幅広いJSONでホットパスをSubcolumnizationで保持しながら、ロングテールパスをスパースストレージに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.x機能の境界
このガイドはDoris 3.xで利用可能な機能のみを扱います。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、パス固有のインデックスにはDoris 3.1.0以降が必要です。新しいバージョンのDOCモードガイダンスはDoris 3.xには適用されません。
:::

## VARIANTが適している場合

以下のすべてまたは大部分が当てはまる場合に`VARIANT`を使用してください：

- 入力がJSONまたは時間の経過とともにフィールドが進化するその他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに対して実行される。
- カラム分析パフォーマンスを諦めることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が主要な場合は静的カラムを選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件がパス別の分析ではなく、生JSONのアーカイブや文書全体の頻繁な返却である。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれるとき、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラムサブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template (3.1+)。** 選択されたパスを安定した型に固定する`VARIANT`カラムの宣言。型付け、インデックス化、予測可能性が必要な主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパス数が増え続け、メタデータサイズ、書き込みコスト、圧縮コスト、またはクエリコストの増加を始めるとき、wide-JSONの問題があります。

**スパースカラム (3.1+)。** 幅広いJSONに明確なホット/コールドの分割がある場合、スパースカラムはホットパスをSubcolumnizationで保持しながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するために`variant_max_subcolumns_count`を使用してください。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラムサブカラムとして維持され、数千のロングテールパスは共有スパースストレージに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

## 推奨決定パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリが文書全体を返すwide JSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択ではありません。非常に幅広いカラムで`SELECT variant_col`を主要なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト設定が既に適切な出発点です。アクセスパターンが明らかに異常な場合にのみ調整してください。典型的な例には、AIトレーニング機能ペイロード、コネクテッドカーテレメトリ、およびDoris 3.1以降で異常に大規模なSubcolumnizationと多くのパスレベルインデックスを必要とするユーザータグシステムが含まれます。

## ストレージモード

開始点を選択するために以下の表を使用し、対応するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | デフォルトVARIANT | デフォルト設定を維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパスが少ない） | スパース (3.1+) | `variant_max_subcolumns_count` |
| **C** | 注文/支払い/デバイス（主要パスで安定した型が必要） | Schema Template (3.1+) + AまたはB | 主要パスのみを定義 |

### デフォルトモード

これはほとんどの新しい`VARIANT`ワークロードに対して最も安全な出発点です。

典型的な例：クエリが少数の馴染みのあるパスを繰り返し触れるイベントログや監査ペイロード。

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
ワークロードが sparse columns を正当化するのに十分な幅があるかどうかまだ確信が持てず、ほとんどの価値が複数の共通パスでのフィルタリング、集約、およびグループ化から得られる場合に使用してください。

注意点：
- パスの増加が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count` を早期に上げないでください。
- JSONが幅広でない場合、sparse columns を有効にすると利益なしに複雑性が増加します。

### Sparse Mode

> このテンプレートは Doris 3.1.0 以降が必要です。

ペイロードが幅広だが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は sparse columns を選択してください。

典型的な例：広告、テレメトリ、または数千のオプション属性を持つがregularly クエリされるのは数十のみのプロファイル JSON。

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
総キー数が非常に大きいが、主要なワークロードがパスベースのフィルタリング、集約、インデックス作成である場合に使用します。

注意点：
- ホットパス分析がボトルネックの場合、sparse columnsが3.xでの正しい方向性です。
- すべてのパスが事実上Subcolumnizationを通るほど`variant_max_subcolumns_count`を大きく設定しないでください。これは目的に反し、メタデータとcompactionコストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択します。

典型的な例：order、payment、またはdeviceペイロードで、いくつかのビジネスクリティカルなパスが型付きで検索可能である必要がある場合。

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
少数のフィールドのみがビジネスクリティカルで、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。適切な場合は、Schema Templateをsparse columnsやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON schema全体を静的テンプレートに変換しないでください。これでは`VARIANT`の意味がなくなります。
- Schema Templateは主要なパスのみをカバーし、残りは動的に保ちます。

## パフォーマンス

以下のチャートは、10K-path wide-columnデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較したものです。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| Mode | Query Time | Peak Memory |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

要点：

- **VARIANT Defaultが最高速です。** 76 ms — JSONBより12倍、raw STRINGより80倍高速です。
- **JSONBとSTRINGはメモリ使用量が大きいです。** VARIANTの1 MiBに対し、32–48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポート段階

- **Schema Templateで主要パスを早期に固定（3.1+）。** Schema Templateがなければ、システムは自動的に型を推論します。バッチ間で同じパスの型が変更される場合（例：整数から文字列へ）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整します。** ほとんどのワークロードでは、デフォルトで十分です。AI訓練、コネクテッドビークル、ユーザータグシステムなどのワークロードで、Doris 3.1以降で異常に大きなSubcolumnizationスケールと多数のパスレベルインデックスが必要な場合のみ、シナリオ別に調整してください。初日から過度に設定する（非常に大きな`variant_max_subcolumns_count`）と、利益の証拠なしに複雑さが増します。

### クエリ段階

- **非常に幅広い`VARIANT`列に対して`SELECT *`を主要クエリパターンとして使用しないでください。** Doris 3.xにはDOCモードがないため、`SELECT *`や`SELECT variant_col`はすべてのsubcolumnからJSONを再構築する必要があり、幅広い列では非常に高コストです。
- **クエリが型に依存する場合は、常にサブパスをCASTしてください。** 型推論が期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているが整数リテラルと比較する場合、インデックスが使用されず結果が誤る可能性があります。

### 運用段階

- **compaction圧力を監視してください。** Subcolumnの増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **スキーマドリフトを監視してください。** JSON構造が頻繁に変更される場合、ホットパスがsparseストレージに押し込まれ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateでクリティカルパスをロックしてください。
- **型競合を監視してください。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにSchema Templateでそのパスをロックすべきことを示しています。

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
