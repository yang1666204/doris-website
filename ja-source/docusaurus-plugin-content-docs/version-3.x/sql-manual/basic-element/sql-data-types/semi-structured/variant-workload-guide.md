---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "Doris 3.xにおいてVARIANTを使用するタイミング、sparse columnsを有効にするタイミング、およびSchema TemplateやPath固有のindexを追加するタイミングに関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを保存し、頻繁に使用されるパスでSubcolumnizationを使用します。

このガイドは、Doris 3.xで新しい`VARIANT`ワークロードを計画する際に使用してください。以下のような疑問の解決に役立ちます：

- このワークロードでは`VARIANT`を使用すべきか、それとも静的カラムを使用すべきか？
- JSONが大きくなっている場合、デフォルトの動作を維持すべきか、それともスパースカラムを有効にすべきか？
- いつSchema Templateやパス固有のインデックスを追加すべきか？

既に`VARIANT`の使用が決まっており、構文や型のルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保持しながら、DorisがSubcolumnizationを頻繁に使用されるパスに適用することを可能にします。Doris 3.1以降では、幅の広いJSONでホットパスをSubcolumnizationに保持し、ロングテールパスをスパースストレージに移動できるため、すべてのフィールドを事前に固定する必要がありません。
:::

:::note 3.x機能の境界
このガイドはDoris 3.xで利用可能な機能のみを扱います。スパースカラム、`variant_max_subcolumns_count`、`variant_enable_typed_paths_to_sparse`、およびパス固有のインデックスにはDoris 3.1.0以降が必要です。新しいバージョンのDOCモードのガイダンスは、Doris 3.xには適用されません。
:::

## VARIANTが適用される場面

以下の条件のすべて、またはほとんどが当てはまる場合に`VARIANT`を使用してください：

- 入力がJSONまたは時間の経過とともにフィールドが変化するその他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- カラム分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスはインデックスが必要だが、他の多くのパスは動的なままでよい。

以下の条件が支配的な場合は静的カラムを選択してください：

- スキーマが安定しており、事前に既知である。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主な要件は、パス別の分析ではなく、生のJSONをアーカイブすることや文書全体を頻繁に返すことである。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明します。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`カラムに書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template (3.1+)。** 選択されたパスを安定した型に固定する`VARIANT`カラムでの宣言です。型付け、インデックス化、予測可能性を維持する必要がある主要なビジネスフィールドに使用します。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストを増加させ始めると、wide-JSONの問題があります。

**スパースカラム (3.1+)。** 幅の広いJSONに明確なホット/コールドの分割がある場合、スパースカラムはホットパスをSubcolumnizationに保持し、コールド（ロングテール）パスを共有スパースストレージにプッシュします。境界を制御するために`variant_max_subcolumns_count`を使用します。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして残り、数千のロングテールパスは共有スパースストレージに収束します。しきい値は`variant_max_subcolumns_count`によって制御されます。

## 推奨決定パス

![VARIANT Mode Decision Path (Doris 3.x)](/images/variant/variant-decision-flowchart-3x.png)

ほとんどのクエリが文書全体を返すwide JSONの場合、DOCモードがないため、Doris 3.x `VARIANT`は通常最適な選択ではありません。非常に幅の広いカラムで`SELECT variant_col`を主要なクエリパターンにすることは避けてください。

ほとんどのワークロードでは、デフォルト設定が既に適切な開始点です。アクセスパターンが明らかに異常な場合にのみ調整してください。典型的な例には、AIトレーニング機能ペイロード、コネクテッドカー向けテレメトリ、Doris 3.1以降で異常に大規模なSubcolumnizationと多くのパスレベルインデックスを必要とするユーザータグシステムなどがあります。

## ストレージモード

開始点を選ぶために下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT | デフォルトを維持 |
| **B** | 広告 / テレメトリ / ユーザープロファイル（幅広、ホットパスが少ない） | Sparse (3.1+) | `variant_max_subcolumns_count` |
| **C** | 注文 / 支払い / デバイス（キーパスに安定した型が必要） | Schema Template (3.1+) + A または B | キーパスのみ定義 |

### デフォルトモード

これは、新しい`VARIANT`ワークロードのほとんどにとって最も安全な開始点です。

典型例：クエリが少数の馴染みのあるパスに繰り返し触れるイベントログや監査ペイロード。

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
ワークロードが sparse columns を正当化するのに十分な幅があるかどうかまだ確信が持てず、大部分の価値がいくつかの一般的なパスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点:
- パスの増加が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count` を早期に上げないでください。
- JSON が幅広くない場合、sparse columns を有効にすると利点なしに複雑性が増します。

### Sparse Mode

> このテンプレートには Doris 3.1.0 以降が必要です。

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は sparse columns を選択してください。

典型的な例: 数千のオプション属性を持つが、定期的にクエリされるのは数十個のみの広告、テレメトリ、またはプロファイル JSON。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、インデックス作成である場合に使用してください。

注意点:
- ホットパス分析がボトルネックである場合、sparse columnsが3.xでの正しい方向性です。
- `variant_max_subcolumns_count`を大きく設定しすぎて、事実上すべてのパスがSubcolumnizationを通るようにしないでください。それは目的を無効にし、メタデータとコンパクション処理のコストを増加させます。

### Schema Template

> このテンプレートはDoris 3.1.0以降が必要です。

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合にSchema Templateを選択してください。

典型的な例: 注文、支払い、またはデバイスペイロードで、少数のビジネスクリティカルなパスが型付けされ検索可能な状態を維持する必要がある場合。

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
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやパスレベルインデックス戦略が必要な場合に使用してください。適切な場合はSchema Templateとスパース列またはデフォルトの`VARIANT`を組み合わせてください。

注意点：
- JSON schema全体を静的テンプレートにしないでください。それでは`VARIANT`の意味がありません。
- Schema Templateは重要なパスのみをカバーし、残りは動的のままにしてください。

## パフォーマンス

以下のチャートは、10Kパス幅広列データセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較したものです。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time-3x.svg)

| モード | クエリ時間 | ピークメモリ |
|---|---:|---:|
| VARIANT Default | 76 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

重要なポイント：

- **VARIANT Defaultが最高速です。** 76 ms — JSONBより12倍、生のSTRINGより80倍高速です。
- **JSONBとSTRINGはメモリを大量消費します。** VARIANTの1 MiBに対し、32～48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポート段階

- **Schema Templateで重要なパスを早期に固定してください（3.1+）。** Schema Templateがないと、システムは自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状に応じて調整してください。** ほとんどのワークロードでは、デフォルトで十分です。AI訓練、コネクテッドビークル、ユーザータグシステムなどのワークロードでDoris 3.1以降で異常に大きなSubcolumnizationスケールと多くのパスレベルインデックスが必要な場合のみ、シナリオに応じて調整してください。初日から過度に設定すること（非常に大きな`variant_max_subcolumns_count`）は、利益の証拠なしに複雑性を追加します。

### クエリ段階

- **非常に幅広い`VARIANT`列でメインクエリパターンとして`SELECT *`を使用しないでください。** Doris 3.xにはDOCモードがないため、`SELECT *`や`SELECT variant_col`はすべてのサブ列からJSONを再構築する必要があり、幅広列では非常にコストが高くなります。
- **クエリが型に依存する場合は、常にサブパスをCASTしてください。** 型推論は期待と一致しない場合があります。`v['id']`が実際にSTRINGとして格納されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違っている可能性があります。

### 運用段階

- **コンパクション圧力に注意してください。** サブ列の増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み速度が速すぎるかを確認してください。
- **スキーマドリフトに注意してください。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合に注意してください。** 同じパスでの頻繁な型競合は、そのパスをSchema TemplateでロックしてJSONB昇格とインデックス損失を避けるべきことを示しています。

## クイック検証

テーブル作成後、すべてが正常に動作することを検証するための最小限のシーケンスを使用してください：

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
