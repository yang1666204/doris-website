---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、そして設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT`は半構造化JSONを格納し、頻繁に使用されるパスにSubcolumnizationを使用します。

新しい`VARIANT`ワークロードをどのようにモデル化するかを決定する際に、このガイドを使用してください。以下のような質問に答えるのに役立ちます：

- このワークロードは`VARIANT`を使用すべきか、それとも静的列を使用すべきか？
- JSONが非常に幅広い場合、デフォルトの動作、sparse columns、またはDOC modeから始めるべきか？
- どの設定をデフォルトのままにし、どの設定を最初に変更すべきか？

既に`VARIANT`を使用することが決まっており、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT)を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant)を参照してください。

:::tip VARIANTを選ぶ理由
`VARIANT`はJSONの柔軟性を保ちつつ、Dorisは頻繁に使用されるパスにSubcolumnizationを適用できます。これにより、事前にドキュメントスキーマ全体を固定することなく、一般的なフィルタ、集約、パスレベルのインデックスが適切に機能します。非常に幅広いJSONでは、ストレージ層の最適化により、Subcolumnizationがはるかに大きなパス数でも実用的になります。
:::

## VARIANTが適している場合

以下の大部分が当てはまる場合、`VARIANT`は通常適しています：

- 入力がJSONまたは時間とともにフィールドが変化する他の半構造化ペイロードである。
- クエリは通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- カラム型分析パフォーマンスを犠牲にすることなく、スキーマの柔軟性を求めている。
- 一部のパスにはインデックスが必要だが、他の多くのパスは動的のままでよい。

以下の条件が支配的な場合は、静的列を選択してください：

- スキーマが安定しており、事前に分かっている。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付き列として定期的に使用される。
- 主な要件がパス別分析ではなく、生のJSONのアーカイブである。

## 最初の4つの質問

設定に触れる前に、以下の4つの質問に答えてください。

### 1. 明確なホットパスはありますか？

クエリが同じJSONパスに繰り返し触れる場合、Dorisはそれらのパスに対してSubcolumnizationを適用し続けることができます。これが`VARIANT`が最も役立つ場面です。

### 2. 少数のパスに固定型や安定したインデックスが必要ですか？

必要な場合は、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールド向けであり、ドキュメント全体を記述するためのものではありません。

### 3. これは本当に幅広いJSONになっていますか？

パス数が増加し続け、メタデータの負荷、コンパクション負荷、または顕著なクエリオーバーヘッドを生じ始めた場合、幅広いJSONの問題があります。

### 4. 幅広いJSONの場合、ホットパス分析とドキュメント全体の返却のどちらがより重要ですか？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集約、インデックスである場合は、sparse columnsに傾けてください。
- 主な価値がインジェスト効率またはドキュメント全体の返却である場合は、DOC modeに傾けてください。

## 主要概念

以下のストレージモードを読む前に、これらの用語が明確であることを確認してください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT)を参照してください。

**Subcolumnization。** データが`VARIANT`列に書き込まれると、DorisはJSONパスを自動的に発見し、効率的な分析のためにホットパスを独立したカラム型サブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する`VARIANT`列での宣言。型付けされ、インデックス可能で、予測可能であることが必要な主要なビジネスフィールドに使用してください。可能なすべてのパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストの増加を開始した場合、幅広いJSONの問題があります。

**Sparse columns。** 幅広いJSONに明確なホット/コールド分離がある場合、sparse columnsはホットパスをSubcolumnizationに保持しながら、コールド（ロングテール）パスを共有sparse storageにプッシュします。Sparse storageは、より良い読み取り並列性のために複数の物理列間でのシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上に示されているように、ホットパス（`user_id`、`page`など）は完全な分析速度を持つ独立したカラム型サブカラムとして保持され、数千のロングテールパスは共有sparse storageに収束します。閾値は`variant_max_subcolumns_count`によって制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のsparse columnが読み取りボトルネックになる可能性があります。Sparse shardingはロングテールパスをハッシュによって複数の物理列（`variant_sparse_hash_shard_count`）に分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOC mode。** 書き込み時にSubcolumnizationを遅延し、追加でオリジナルのJSONをmapフォーマットのストアドフィールド（**doc map**）として格納します。これにより、追加ストレージのコストで高速インジェストと効率的なドキュメント全体の返却が可能になります。Subcolumnizationは後でコンパクション中に発生します。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上に示されているように、書き込み時にJSONはDoc Storeにそのまま保存され、高速インジェストが可能です。サブカラムは後でコンパクション中に抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全なカラム速度でマテリアライズされたサブカラムから読み取り、ドキュメント全体のクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Storeから直接読み取ります。

DOC modeには、クエリされたパスがマテリアライズされているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされたパスが既にサブカラムに抽出されている（コンパクション後または`variant_doc_materialization_min_rows`が満たされた場合）。デフォルトVARIANTと同じ完全なカラム速度で読み取り。
- **DOC Map**: クエリされたパスがまだマテリアライズされていない。クエリは値を見つけるためにdoc map全体のスキャンにフォールバック — 幅広いJSONでは大幅に遅くなります。
- **DOC Map (Sharded)**: 同じフォールバックですが、`variant_doc_hash_shard_count`でdoc mapが複数の物理列に分散され、並列スキャンとはるかに高速な復旧が可能になります。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。特に幅広いJSONの場合、数千のサブカラムが存在する際にメタデータボトルネックを排除するため、あらゆる`VARIANT`テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選ぶために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告/テレメトリ/ユーザープロファイル（幅広い、ホットパスは少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力/トレース/アーカイブ（インジェスト優先またはドキュメント全体返却） | DOC mode + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文/支払い/デバイス（キーパスに安定した型が必要） | Schema Template + A or B | キーパスのみ定義 |

### デフォルトモード

これは、ほとんどの新しい`VARIANT`ワークロードにとって最も安全な開始点です。

典型例：イベントログや監査ペイロードで、クエリが少数の馴染みのあるパスに繰り返し触れる場合。

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
まだワークロードがsparse columnsやDOCモードを正当化するほど幅広いかどうかが不明で、主な価値が複数の共通パスでのフィルタリング、集約、グループ化から得られる場合に使用します。

注意点：
- パスの増加が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count`を早期に増加させないでください。
- JSONが幅広くない場合、sparse columnsやDOCモードを有効にすると、利益なしに複雑さが増します。

### Sparseモード

ペイロードが幅広いが、ほとんどのクエリが依然として小さなホットパスのセットに焦点を当てている場合は、sparse columnsを選択します。

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
総キー数が非常に大きいが、主要なワークロードが依然としてパスベースのフィルタリング、集約、インデックス化である場合に使用してください。

注意点:
- ホットパス分析がボトルネックである場合は、最初にDOCモードに移行しないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。事実上すべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大きな抽出サブカラムスケールを必要とする場合は、[DOC Mode](#doc-mode-template)を推奨します。

### DOC Mode {#doc-mode-template}

JSON文書全体を返すか、パスベース分析の最適化よりも取り込みオーバーヘッドの最小化が重要な場合にDOCモードを選択してください。

典型例: モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合:

- Subcolumnizationスケールが極めて大きくなる場合（10,000パスに近づく場合）、ハードウェア要件は急速に上昇します。このスケールではDOCモードがより安定した選択肢です。
- コンパクションメモリは、デフォルトの積極的Subcolumnizationと比較して約3分の2削減できます。
- スパースワイドカラム取り込みワークロードにおいて、スループットを約5〜10倍改善できます。
- クエリが`VARIANT`値全体を読み取る場合（`SELECT variant_col`）、DOCモードは数千のサブカラムから文書を再構築することを回避し、桁違いの高速化を実現します。

**はじめに:**

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
インジェスト スループットが最優先の場合、ワークロードが頻繁に完全な JSON ドキュメントを戻す必要がある場合、または非常に幅広いカラムが `SELECT variant_col` で頻繁に読み取られる場合に使用します。

注意点：
- DOC モードは、すべての幅広い JSON ワークロードに対するデフォルトの解決策ではありません。ホットパス分析が優勢な場合、通常はスパースカラムの方が適しています。
- DOC モードとスパースカラムは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスに安定した型、安定した動作、またはパス固有のインデックスが必要な場合は、Schema Template を選択します。

典型例：注文、支払い、またはデバイスのペイロードにおいて、いくつかのビジネス クリティカルなパスが型付けされ、検索可能な状態を維持する必要がある場合。

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
一部のフィールドのみがビジネスクリティカルで、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。必要に応じてSchema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON schema全体を静的テンプレートにしないでください。それでは`VARIANT`の意味がなくなります。
- Schema Templateは重要なパスのみをカバーし、残りは動的なままにしてください。

## Performance

以下のチャートは、10Kパスの幅広カラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

- **マテリアライズされたサブカラムが勝利。** DefaultとDOC Materializedの両方が約76 msを実現 — 生のSTRINGより80倍高速、JSONBより12倍高速。
- **DOC Mapとシャーディングが有効。** doc mapをシャーディングすることで、非マテリアライズパスのクエリ時間が2.5秒から148 msに短縮。
- **JSONBとSTRINGはメモリ使用量が多い。** VARIANTモードの1 MiBに対し、32–48 GiBのピークメモリを消費。

## Best Practices

### Import Phase

- **新しい`VARIANT`テーブルにはStorage Format V3から始める。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、幅広JSONワークロードでファイルオープンが遅く、メモリオーバーヘッドが高くなります。
- **Schema Templateで重要なパスを早期に固定する。** Schema Templateがないと、システムは自動的に型を推論します。同じパスがバッチ間で型を変更した場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状に基づいて調整する。** ほとんどのワークロードでは、デフォルトで十分です。AI学習、コネクテッドカー、ユーザータグシステムなど、異常に大きなSubcolumnizationスケールと多くのパスレベルインデックスが必要なワークロードの場合のみ、シナリオ別に調整してください。初日から過剰に設定する（非常に大きな`variant_max_subcolumns_count`、不要な場合のDOCモード有効化）と、利益の証拠なしに複雑性が増します。

### Query Phase

- **非常に幅広い`VARIANT`カラムに対してメインクエリパターンとして`SELECT *`を使用しない。** DOCモードがない場合、`SELECT *`または`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようにパスを指定するより大幅に遅くなります。
- **クエリが型に依存する場合は常にサブパスをCASTする。** 型推論は期待と一致しない場合があります。`v['id']`が実際にはSTRINGとして格納されているが、整数リテラルと比較する場合、インデックスは使用されず、結果が間違う可能性があります。

### Operations Phase

- **コンパクション圧力を監視する。** サブカラムの成長はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視する。** 同じパスでの頻繁な型競合は、JSONB昇格とインデックス損失を避けるためにSchema Template経由でパスをロックすべきことを示します。

## Quick Verify

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
- [Storage Format V3](../../../../table-design/storage-format)
- [SEARCH Function](../../../../ai/text-search/search-function)
