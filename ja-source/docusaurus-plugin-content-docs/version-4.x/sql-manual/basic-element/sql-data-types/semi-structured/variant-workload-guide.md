---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスでSubcolumnizationを使用します。

このガイドは、新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に使用してください。次のような疑問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的列を使用すべきか？
- JSONが非常に幅広い場合、デフォルト動作、スパース列、DOCモードのどれから始めるべきか？
- どの設定をデフォルトのままにして、どの設定を最初に変更すべきか？

すでに`VARIANT`を使用したいことが分かっており、構文や型のルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip なぜVARIANTを選ぶのか
`VARIANT`はJSONの柔軟性を保ちながら、Dorisが頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、文書スキーマ全体を事前に固定することなく、一般的なフィルタ、集計、パスレベルのインデックスが適切に動作します。非常に幅広いJSONでは、ストレージレイヤーの最適化により、はるかに大きなパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

通常、以下のほとんどが当てはまる場合、`VARIANT`は適しています：

- 入力がJSONまたは時間とともにフィールドが進化する他の半構造化ペイロードである。
- クエリが通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットにアクセスする。
- 列指向分析のパフォーマンスを犠牲にすることなく、スキーマの柔軟性が必要である。
- 一部のパスにはインデックスが必要であり、他の多くのパスは動的のままでよい。

次の条件が支配的な場合は、静的列を選択してください：

- スキーマが安定しており、事前に知られている。
- 中核となるフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される。
- 主な要件がパス別の分析ではなく、生のJSONのアーカイブである。

## まず4つの質問

設定を変更する前に、これら4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスに繰り返しアクセスする場合、DorisはそれらのパスにSubcolumnizationを継続して適用できます。これが`VARIANT`が最も役立つ場面です。

### 2. 固定型や安定したインデックスが必要なパスはわずかですか？

そうであれば、それらのパスのみにSchema Templateを使用してください。これはビジネス上重要な少数のフィールドセット用であり、文書全体を記述するためのものではありません。

### 3. これは本当に幅広いJSONになっているか？

パス数が継続的に増加し、メタデータの負荷、コンパクションの負荷、または顕著なクエリオーバーヘッドを引き起こし始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、何がより重要か：ホットパス分析か文書全体の返却か？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集計、インデックスである場合、スパース列に傾倒する。
- 主な価値がインジェスト効率または文書全体の返却である場合、DOCモードに傾倒する。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2〜3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** `VARIANT`列にデータが書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のために独立した列指向サブ列としてホットパスを抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`列の宣言。型付け、インデックス可能、予測可能である必要がある主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしてはいけません。

**Wide JSON。** 異なるパスの数が継続的に増加し、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストを増加させ始めた場合、幅広いJSONの問題があります。

**スパース列。** 幅広いJSONに明確なホット/コールド分割がある場合、スパース列はホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有スパースストレージにプッシュします。スパースストレージは、より良い読み取り並列性のために複数の物理列でのシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図に示すように、ホットパス（`user_id`、`page`など）は完全な分析速度で独立した列指向サブ列として残り、数千のロングテールパスは共有スパースストレージに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**スパースシャーディング。** ロングテールパス数が非常に大きい場合、単一のスパース列が読み取りボトルネックになる可能性があります。スパースシャーディングは、ロングテールパスをハッシュによって複数の物理列（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOCモード。** 書き込み時にSubcolumnizationを遅延し、さらに元のJSONをマップ形式の格納フィールド（**doc map**）として保存します。これにより、追加のストレージコストと引き換えに、高速なインジェストと効率的な文書全体の返却を実現します。Subcolumnizationは後でコンパクション中に実行されます。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図に示すように、書き込み時にJSONは高速インジェストのためにDoc Storeにそのまま保存されます。サブ列は後でコンパクション中に抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全な列指向速度で実体化されたサブ列から読み取り、文書全体のクエリ（`SELECT v`）はサブ列から再構築することなく、Doc Storeから直接読み取ります。

DOCモードは、クエリされたパスが実体化されているかどうかに応じて、3つの異なる読み取りパスを持ちます：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスが既にサブ列に抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた時）。デフォルトVARIANTと同じ完全な列指向速度で読み取り。
- **DOC Map**: クエリされたパスがまだ実体化されていない。クエリは値を見つけるためにdoc map全体をスキャンするフォールバックとなる — 幅広いJSONでは大幅に遅い。
- **DOC Map (Sharded)**: 同じフォールバックだが、`variant_doc_hash_shard_count`によりdoc mapが複数の物理列に分散され、並列スキャンとはるかに高速な復旧が可能。

**ストレージフォーマットV3。** 列メタデータをセグメントフッターから分離します。特に幅広いJSONの場合、数千のサブ列が存在する際のメタデータボトルネックを排除するため、すべての`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選択するために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要な設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパスは少ない） | Sparse + V3 | `variant_max_subcolumns_count`, `variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先または文書全体返却） | DOC mode + V3 | `variant_enable_doc_mode`, `variant_doc_materialization_min_rows` |
| **D** | 注文/決済/デバイス（主要パスに安定した型が必要） | Schema Template + A or B | 主要パスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型的な例：クエリが馴染みのある少数のパスに繰り返しアクセスするイベントログや監査ペイロード。

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
    "replication_num" = "1",
    "storage_format" = "V3"
);
```
ワークロードがsparse columnsやDOCモードを正当化するのに十分な幅があるかどうかまだ確信が持てず、価値の大部分がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用します。

注意点：
- パスの増大が既に負荷を引き起こしている場合を除き、早期に`variant_max_subcolumns_count`を上げないでください。
- JSONが幅広でない場合、sparse columnsやDOCモードを有効にすると利益なく複雑さが増します。

### Sparse Mode

ペイロードが幅広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合はsparse columnsを選択します。

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
            'variant_sparse_hash_shard_count' = '64'
        )
    >
)
DUPLICATE KEY(`ts`, `device_id`)
DISTRIBUTED BY HASH(`device_id`) BUCKETS 32
PROPERTIES (
    "replication_num" = "1",
    "storage_format" = "V3"
);
```
キーの総数が非常に大きいものの、主要なワークロードが依然としてパスベースのフィルタリング、集約、インデックス作成である場合に使用してください。

注意点：
- ホットパス分析がボトルネックになっている場合は、まずDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。実質的にすべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードで本当に非常に大規模な抽出サブカラムのスケールが必要な場合は、[DOC Mode](#doc-mode-template)を優先してください。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すことや取り込みオーバーヘッドを最小化することが、パスベース分析の最適化よりも重要な場合はDOCモードを選択してください。

典型的な例：モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合：

- Subcolumnizationのスケールが極めて大きくなる場合（10,000パスに近づく場合）、ハードウェア要件は急速に増大します。この規模ではDOCモードがより安定した選択です。
- コンパクションメモリは、デフォルトの積極的Subcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5～10倍向上する可能性があります。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムから文書を再構築することを回避し、桁違いの高速化を実現します。

**はじめに：**

```sql
CREATE TABLE IF NOT EXISTS trace_archive (
    ts DATETIME NOT NULL,
    trace_id VARCHAR(64) NOT NULL,
    span VARIANT<
        'service_name' : STRING,
        properties(
            'variant_enable_doc_mode' = 'true',
            'variant_doc_materialization_min_rows' = '10000',
            'variant_doc_hash_shard_count' = '64'
        )
    >
)
DUPLICATE KEY(`ts`, `trace_id`)
DISTRIBUTED BY HASH(`trace_id`) BUCKETS 32
PROPERTIES (
    "replication_num" = "1",
    "storage_format" = "V3"
);
```
ingest スループットが最優先である場合、ワークロードが完全な JSON ドキュメントを頻繁に取得する必要がある場合、または非常に幅の広いカラムが `SELECT variant_col` でよく読み取られる場合に使用してください。

注意点：
- DOC モードは、すべての幅の広い JSON ワークロードに対するデフォルトの答えではありません。ホットパス分析が支配的である場合、sparse columns の方が通常適しています。
- DOC モードと sparse columns は相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合は Schema Template を選択してください。

典型的な例：いくつかのビジネスクリティカルなパスが型付けされ、検索可能な状態を維持する必要がある order、payment、または device のペイロード。

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
    "replication_num" = "1",
    "storage_format" = "V3"
);
```
ビジネスクリティカルなフィールドが少数で、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用します。適切な場合は、Schema Templateをスパース列やデフォルトの`VARIANT`と組み合わせます。

注意点：
- JSON スキーマ全体を静的テンプレートにしないでください。それでは`VARIANT`の意味がありません。
- Schema Template は重要なパスのみをカバーし、残りは動的のままにしておきます。

## Performance

以下のチャートは、10K パス幅広列データセット（200K 行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較したものです。

![Wide-Column Single-Path Extraction: Query Time](/images/variant/variant-bench-query-time.svg)

| Mode | Query Time | Peak Memory |
|---|---:|---:|
| DOC Materialized | 76 ms | 1 MiB |
| VARIANT Default | 76 ms | 1 MiB |
| DOC Map (Sharded) | 148 ms | 1 MiB |
| JSONB | 887 ms | 32 GiB |
| DOC Map | 2,533 ms | 1 MiB |
| MAP\<STRING,STRING\> | 2,800 ms | 1 MiB |
| STRING (raw JSON) | 6,104 ms | 48 GiB |

重要なポイント：

- **実体化されたサブカラムが最も高速。** DefaultとDOC Materializedは両方とも約76 ms — 生のSTRINGより80倍、JSONBより12倍高速です。
- **DOC Map とシャーディングが効果的。** doc mapをシャーディングすることで、実体化されていないパスのクエリ時間が2.5秒から148 msに短縮されます。
- **JSONBとSTRINGはメモリを大量消費。** VARIANTモードが1 MiBに対して、これらは32〜48 GiBのピークメモリを消費します。

## Best Practices

### Import Phase

- **新しい`VARIANT`テーブルにはStorage Format V3から始める。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、幅広JSONワークロードではファイル開放が遅く、メモリオーバーヘッドが高くなります。
- **Schema Templateで重要なパスを早期に固定する。** Schema Templateがないと、システムが自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から開始し、症状に応じて調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI学習、コネクテッドビークル、ユーザータグシステムなど、異常に大きなSubcolumnizationスケールと多くのパスレベルインデックスが必要なワークロードでのみ、シナリオ別に調整します。初日から過剰設定（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）を行うと、利益の証拠なしに複雑性が増します。

### Query Phase

- **非常に幅広い`VARIANT`列に対して`SELECT *`を主なクエリパターンとして使用しない。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`は全てのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスをCASTする。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして保存されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違う可能性があります。

### Operations Phase

- **コンパクション圧力を監視する。** サブカラムの増加によりマージコストが増加します。Compaction Scoreが上昇し続ける場合は、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認します。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックします。
- **型競合を監視する。** 同じパスでの頻繁な型競合は、そのパスをSchema TemplateでロックしてJSONB昇格とインデックス損失を避ける必要があることを示しています。

## Quick Verify

テーブル作成後、すべてが正常に動作することを確認するために、この最小限のシーケンスを使用します：

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
- [Storage Format V3](../../../../table-design/storage-format)
- [SEARCH Function](../../../../ai/text-search/search-function)
