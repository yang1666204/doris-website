---
{
  "title": "VARIANT ワークロードガイド",
  "language": "ja",
  "description": "VARIANTを使用するタイミング、default、sparse、DOCモード、およびSchema Templateの選択方法、および設定の開始点に関する決定ガイド。"
}
---
## 概要

`VARIANT` は半構造化 JSON を格納し、頻繁に使用されるパスに対してSubcolumnizationを使用します。

新しい `VARIANT` ワークロードをどのようにモデリングするかを決定する際に、このガイドを使用してください。以下のような質問への回答に役立ちます：

- このワークロードは `VARIANT` を使用すべきか、静的カラムを使用すべきか？
- JSON が非常に幅広い場合、デフォルト動作、sparse columns、または DOC mode から始めるべきか？
- どの設定をデフォルトのままにし、どの設定を最初に変更すべきか？

すでに `VARIANT` を使用することを決めており、構文や型ルールのみが必要な場合は、[VARIANT](./VARIANT) を参照してください。最小限の実行可能なインポート例が必要な場合は、[Import Variant Data](../../../../data-operate/import/complex-types/variant) を参照してください。

:::tip VARIANTを選択する理由
`VARIANT` は JSON の柔軟性を保ちながら、Doris は頻繁に使用されるパスに対してSubcolumnizationを適用できます。これにより、一般的なフィルタ、集約、パスレベルのインデックスが、ドキュメントスキーマ全体を事前に固定することなく適切に動作します。非常に幅広い JSON では、ストレージ層の最適化により、はるかに大きなパス数でもSubcolumnizationが実用的になります。
:::

## VARIANTが適している場合

以下の条件の大部分が当てはまる場合、通常 `VARIANT` が適しています：

- 入力が JSON または時間の経過とともにフィールドが進化する他の半構造化ペイロードである。
- クエリが通常、すべての行のすべてのフィールドではなく、ホットパスのサブセットに触れる。
- カラム分析のパフォーマンスを諦めることなく、スキーマの柔軟性を求めている。
- 一部のパスはインデックス化が必要で、多くの他のパスは動的なままでよい。

以下の条件が支配的な場合は静的カラムを選択してください：

- スキーマが安定しており、事前に既知である。
- コアフィールドが結合キー、ソートキー、または厳密に制御された型付きカラムとして定期的に使用される。
- 主要な要件がパスによる分析ではなく、生の JSON をアーカイブすることである。

## まず4つの質問

設定に触れる前に、これらの4つの質問に答えてください。

### 1. 明確なホットパスがあるか？

クエリが同じ JSON パスに繰り返し触れる場合、Doris はそれらのパスにSubcolumnizationを適用し続けることができます。これが `VARIANT` が最も役立つ場面です。

### 2. 少数のパスに固定型や安定したインデックスが必要か？

「はい」の場合、それらのパスのみにSchema Templateを使用してください。これは少数のビジネスクリティカルなフィールドのためのものであり、ドキュメント全体を記述するためのものではありません。

### 3. これは本当に幅広い JSON になっているか？

パス数が増加し続け、メタデータ圧力、コンパクション圧力、または顕著なクエリオーバーヘッドを作り始めるとき、幅広い JSON の問題があります。

### 4. 幅広い JSON では、ホットパス分析とドキュメント全体の返却のどちらがより重要か？

- 主な価値がホットフィールドでのパスベースのフィルタリング、集約、インデックス化である場合、sparse columns に傾いてください。
- 主な価値がインジェスト効率またはドキュメント全体の返却である場合、DOC mode に傾いてください。

## 主要概念

以下のストレージモードを読む前に、これらの用語を明確にしてください。それぞれ2-3行で説明されています。実装の詳細については、[VARIANT](./VARIANT) を参照してください。

**Subcolumnization。** データが `VARIANT` カラムに書き込まれるとき、Doris は自動的に JSON パスを発見し、効率的な分析のためにホットパスを独立したカラムサブカラムとして抽出します。

![Default VARIANT: Automatic Subcolumn Extraction](/images/variant/variant-default-storage.png)

**Schema Template。** 選択されたパスを安定した型に固定する `VARIANT` カラムでの宣言。型付け、インデックス化、予測可能性を保つ必要がある主要なビジネスフィールドに使用してください。すべての可能なパスを列挙しようとしないでください。

**Wide JSON。** 異なるパスの数が増加し続け、メタデータサイズ、書き込みコスト、コンパクションコスト、またはクエリコストを増加させ始めるとき、幅広い JSON の問題があります。

**Sparse columns。** 幅広い JSON に明確なホット/コールドの分割がある場合、sparse columns はホットパスをSubcolumnizationに保ちながら、コールド（ロングテール）パスを共有sparse ストレージにプッシュします。Sparse ストレージは、より良い読み取り並列性のために複数の物理カラムにわたるシャーディングをサポートします。

![Sparse Columns: Hot/Cold Path Separation](/images/variant/variant-sparse-storage.png)

上図のように、ホットパス（`user_id`、`page` など）は完全な分析速度で独立したカラムサブカラムとして残り、数千のロングテールパスは共有sparse ストレージに収束します。閾値は `variant_max_subcolumns_count` で制御されます。

**Sparse sharding。** ロングテールパス数が非常に大きい場合、単一のsparse カラムが読み取りボトルネックになる可能性があります。Sparse sharding は、複数の物理カラム（`variant_sparse_hash_shard_count`）にわたってハッシュでロングテールパスを分散し、並列でスキャンできるようにします。

![Sparse Sharding: Parallel Read for Long-Tail Paths](/images/variant/variant-sparse-sharding.png)

**DOC mode。** 書き込み時のSubcolumnizationを遅延し、さらに元の JSON をマップ形式の保存フィールド（**doc map**）として保存します。これにより、追加のストレージコストで高速なインジェストと効率的なドキュメント全体の返却が可能になります。Subcolumnization は後でコンパクション中に発生します。

![DOC Mode: Deferred Extraction + Fast Document Return](/images/variant/variant-doc-mode.png)

上図のように、書き込み中に JSON は高速インジェストのためにDoc Store にそのまま保存されます。サブカラムは後でコンパクション中に抽出されます。読み取り時、パスベースのクエリ（例：`SELECT v['user_id']`）は完全なカラム速度でマテリアライズされたサブカラムから読み取り、ドキュメント全体のクエリ（`SELECT v`）はサブカラムから再構築することなくDoc Store から直接読み取ります。

DOC mode には、クエリされるパスがマテリアライズされているかどうかに応じて3つの異なる読み取りパスがあります：

![DOC Mode: Read Path Details](/images/variant/variant-doc-mode-readpaths.png)

- **DOC Materialized**: クエリされるパスがすでにサブカラムに抽出されている（コンパクション後または `variant_doc_materialization_min_rows` が満たされた場合）。デフォルト VARIANT と同じ完全なカラム速度で読み取ります。
- **DOC Map**: クエリされるパスがまだマテリアライズされていない。クエリは値を見つけるためにdoc map 全体のスキャンにフォールバックします — 幅広い JSON では著しく遅くなります。
- **DOC Map (Sharded)**: 同じフォールバック、ただし `variant_doc_hash_shard_count` でdoc map が複数の物理カラムに分散され、並列スキャンとはるかに高速な回復が可能になります。

**Storage Format V3。** カラムメタデータをセグメントフッターから分離します。特に幅広い JSON において、数千のサブカラムが存在する場合にメタデータボトルネックを排除するため、任意の `VARIANT` テーブルに推奨されます。

## 推奨決定パス

![VARIANT Mode Decision Path](/images/variant/variant-decision-flowchart.png)

## ストレージモード

開始点を選択するために以下の表を使用し、該当するセクションを読んでください。

| | 典型的なシナリオ | 推奨モード | 主要設定 |
|---|---|---|---|
| **A** | イベントログ、監査ログ | Default VARIANT + V3 | デフォルトを維持 |
| **B** | 広告 / テレメトリ / ユーザープロファイル（幅広い、ホットパスは少数） | Sparse + V3 | `variant_max_subcolumns_count`、`variant_sparse_hash_shard_count` |
| **C** | モデル出力 / トレース / アーカイブ（インジェスト優先またはドキュメント全体返却） | DOC mode + V3 | `variant_enable_doc_mode`、`variant_doc_materialization_min_rows` |
| **D** | 注文 / 支払い / デバイス（主要パスに安定した型が必要） | Schema Template + A または B | 主要パスのみを定義 |

### デフォルトモード

これは、ほとんどの新しい `VARIANT` ワークロードにとって最も安全な開始点です。

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
    "replication_num" = "1",
    "storage_format" = "V3"
);
```
ワークロードが sparse columns や DOC mode を正当化するほど十分に広いかどうかまだ確信が持てず、大部分の価値がいくつかの共通パスでのフィルタリング、集約、グループ化から得られる場合に使用してください。

注意点：
- パスの増大が既に負荷を引き起こしている場合を除き、`variant_max_subcolumns_count` を早期に上げないでください。
- JSON が広くない場合、sparse columns や DOC mode を有効にすると利益なしに複雑性が追加されます。

### Sparse Mode

ペイロードが広いが、ほとんどのクエリが依然として少数のホットパスに焦点を当てている場合は sparse columns を選択してください。

典型例：何千ものオプション属性を持つが、定期的にクエリされるのは数十個のみの広告、テレメトリ、またはプロファイル JSON。

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
総キー数が非常に大きいが、主要なワークロードがパスベースのフィルタリング、集約、およびインデックス化である場合に使用します。

注意点：
- ホットパス解析がボトルネックの場合、最初にDOCモードに飛びつかないでください。
- `variant_max_subcolumns_count`のデフォルトは`2048`で、これはほとんどのワークロードにおける自動Subcolumnizationの適切な開始点です。事実上すべてのパスがSubcolumnizationを通るほど大きく設定しないでください。ワークロードが本当に非常に大規模な抽出サブカラムスケールを必要とする場合は、[DOCモード](#doc-mode-template)を選択してください。

### DOCモード {#doc-mode-template}

JSON文書全体を返すか、パスベース解析の最適化よりも取り込みオーバーヘッドの最小化が重要な場合は、DOCモードを選択してください。

典型的な例：モデルレスポンス、トレーススナップショット、または完全なペイロードとして返されることが多いアーカイブされたJSON文書。

DOCモードが有効な場合：

- Subcolumnizationスケールが極端に大きくなる場合（10,000パスに近づく）、ハードウェア要件が急速に上昇します。この規模ではDOCモードがより安定した選択肢です。
- コンパクション用メモリは、デフォルトのeager Subcolumnizationと比較して約3分の2削減できます。
- スパースなワイドカラム取り込みワークロードでは、スループットが約5～10倍改善できます。
- クエリが`VARIANT`値全体（`SELECT variant_col`）を読み取る場合、DOCモードは数千のサブカラムから文書を再構築することを回避し、桁違いの高速化を実現します。

**開始方法：**

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
ingest throughputが最優先の場合、ワークロードで完全なJSONドキュメントを頻繁に取得する必要がある場合、または非常に幅広いカラムを`SELECT variant_col`で頻繁に読み取る場合に使用してください。

注意点:
- DOCモードは、すべての幅広いJSONワークロードに対するデフォルトの答えではありません。ホットパス分析が支配的な場合は、通常sparse columnsの方が適しています。
- DOCモードとsparse columnsは相互排他的です。同時に有効にすることはできません。

### Schema Template

少数のパスで安定した型、安定した動作、またはパス固有のインデックスが必要な場合はSchema Templateを選択してください。

典型的な例: order、payment、またはdevice payloadで、いくつかのビジネスクリティカルなパスが型付けされ検索可能な状態を維持する必要がある場合。

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
少数のフィールドのみがビジネスクリティカルで、それらのパスでより厳密な型付けやパスレベルのインデックス戦略が必要な場合に使用してください。必要に応じてSchema Templateをスパースカラムやデフォルトの`VARIANT`と組み合わせてください。

注意点：
- JSON schema全体を静的テンプレートにしないでください。それでは`VARIANT`の意味がなくなります。
- Schema Templateは重要なパスのみをカバーし、残りは動的に保つべきです。

## パフォーマンス

以下のチャートは、10Kパス幅のワイドカラムデータセット（200K行、1つのキーを抽出、16 CPU、3回実行の中央値）での単一パス抽出時間を比較しています。

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

- **Materializedサブカラムが優位。** DefaultとDOC Materializedは両方とも約76ms — 生のSTRINGより80倍高速、JSONBより12倍高速です。
- **シャーディング付きDOC Mapが効果的。** doc mapをシャーディングすることで、非materialized化パスのクエリ時間を2.5秒から148msに短縮します。
- **JSONBとSTRINGはメモリを大量消費。** VARIANTモードの1 MiBに対して、32-48 GiBのピークメモリを消費します。

## ベストプラクティス

### インポートフェーズ

- **新しい`VARIANT`テーブルではStorage Format V3から始める。** V3はカラムメタデータをセグメントフッターから分離します。これがないと、ワイドJSONワークロードはファイルオープンが遅く、メモリオーバーヘッドが高くなります。
- **Schema Templateで重要なパスを早期に固定する。** Schema Templateがないと、システムは自動的に型を推論します。同じパスがバッチ間で型を変更する場合（例：整数から文字列）、JSONBに昇格され、そのパスのインデックスが失われます。
- **デフォルト設定から始めて、症状に応じて調整する。** ほとんどのワークロードではデフォルトで十分です。AI学習、コネクテッドビークル、ユーザータグシステムなどのワークロードで異常に大きなSubcolumnizationスケールと多数のパスレベルインデックスが必要な場合のみ、シナリオ別に調整してください。初日から過度に設定すること（非常に大きな`variant_max_subcolumns_count`、不要なDOCモードの有効化）は、効果の証拠なしに複雑性を追加します。

### クエリフェーズ

- **非常に幅広い`VARIANT`カラムに対して`SELECT *`をメインのクエリパターンとして使用しない。** DOCモードなしでは、`SELECT *`や`SELECT variant_col`はすべてのサブカラムから大きなJSONを再構築する必要があり、`SELECT v['path']`のようなパス指定よりもはるかに遅くなります。
- **クエリが型に依存する場合は、常にサブパスをCASTする。** 型推論は期待と一致しない可能性があります。`v['id']`が実際にはSTRINGとして格納されているのに整数リテラルと比較すると、インデックスが使用されず、結果が間違っている可能性があります。

### 運用フェーズ

- **コンパクション圧力を監視する。** サブカラムの増加はマージコストを増加させます。Compaction Scoreが上昇し続ける場合、`variant_max_subcolumns_count`が高すぎるか、取り込み率が速すぎるかを確認してください。
- **スキーマドリフトを監視する。** JSON構造が頻繁に変更される場合、ホットパスがスパースストレージにプッシュされ、突然のクエリ速度低下を引き起こす可能性があります。Schema Templateで重要なパスをロックしてください。
- **型競合を監視する。** 同じパスでの頻繁な型競合は、そのパスがJSONB昇格とインデックス損失を避けるためにSchema Template経由でロックされるべきであることを示します。

## クイック検証

テーブル作成後、すべてが機能することを確認するために、この最小限のシーケンスを使用してください：

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
