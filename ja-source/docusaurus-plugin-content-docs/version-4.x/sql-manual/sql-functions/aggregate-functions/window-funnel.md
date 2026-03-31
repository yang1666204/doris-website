---
{
  "title": "WINDOW_FUNNEL",
  "language": "ja",
  "description": "WINDOWFUNNEL関数は、指定された時間ウィンドウ内でイベントチェーンを検索し、最大値を計算することによって、ユーザー行動シーケンスを分析します"
}
---
## 説明

WINDOW_FUNNEL関数は、指定された時間ウィンドウ内でイベントチェーンを検索し、イベントチェーンで完了した最大ステップ数を計算することで、ユーザーの行動シーケンスを分析します。この関数は、ウェブサイト訪問から最終購入までのユーザーコンバージョン分析など、コンバージョンファネル分析に特に有用です。

この関数は以下のアルゴリズムに従って動作します：

- 関数はチェーン内の最初の条件をトリガーするデータを検索し、イベントカウンターを1に設定します。これがスライディングウィンドウが開始される瞬間です。
- チェーンからのイベントがウィンドウ内で順次発生する場合、カウンターが増分されます。イベントのシーケンスが中断された場合、カウンターは増分されません。
- データに異なる完了ポイントで複数のイベントチェーンがある場合、関数は最も長いチェーンのサイズのみを出力します。

## 構文

```sql
WINDOW_FUNNEL(<window>, <mode>, <timestamp>, <event_1>[, event_2, ... , event_n])
```
## パラメータ

| パラメータ | 説明 |
| -- | -- |
| `<window>` | window は秒単位での時間ウィンドウの長さです |
| `<mode>` | 合計4つのモードがあります：`default`、`deduplication`、`fixed`、`increase`。詳細については、以下の**Mode**を参照してください。 |
| `<timestamp>` | timestamp はDATETIME型の列を指定し、スライディング時間ウィンドウがその上で動作します |
| `<event_n>` | evnet_n はeventID = 1004のようなboolean式です |

**Mode**

    - `default`：標準的なファネル計算。Dorisは時間ウィンドウ内で指定された順序にマッチする最長のイベントチェーンを検索します。どの条件にもマッチしないイベントは無視されます。

    - `deduplication`：`default`ベースですが、現在のチェーンで既にマッチしたイベントは再度出現できません。例えば、条件リストが[event1='A', event2='B', event3='C', event4='D']で、元のイベントチェーンが`A-B-C-B-D`の場合、2番目の`B`がチェーンを破るため、マッチしたイベントチェーンは`A-B-C`となり、max levelは`3`になります。

    - `fixed`：チェーンは指定された順序で進む必要があり、中間ステップをスキップできません。直前の条件がマッチする前に後の条件にマッチするイベントが現れると、チェーンは停止します。Doris 4.1以降、どの条件にもマッチしないイベントは無視され、チェーンを破ることはありません。例えば、[event1='A', event2='B', event3='C', event4='D']において、`A-B-D-C`は`A-B`とlevel`2`を返します；`A-B-X-C-D`（`X`はどの条件にもマッチしない）では、Doris 4.1以降は`A-B-C-D`を返しますが、それ以前のバージョンでは`A-B`で停止します。

    - `increase`：`default`ベースですが、マッチしたイベントは厳密に増加するタイムスタンプを持つ必要があります。2つのマッチしたイベントが同じタイムスタンプを持つ場合、後のイベントはチェーンを進めることができません。

## 戻り値
指定された時間ウィンドウ内で完了した連続ステップの最大数を表す整数を返します。

## 例

### example1: default mode

`default`モードを使用して、異なる`user_id`に対応する連続イベントの最大数を、時間ウィンドウ`5`分で見つけ出します：

```sql
CREATE TABLE events(
    user_id BIGINT,
    event_name VARCHAR(64),
    event_timestamp datetime,
    phone_brand varchar(64),
    tab_num int
) distributed by hash(user_id) buckets 3 properties("replication_num" = "1");

INSERT INTO
    events
VALUES
    (100123, 'login', '2022-05-14 10:01:00', 'HONOR', 1),
    (100123, 'visit', '2022-05-14 10:02:00', 'HONOR', 2),
    (100123, 'order', '2022-05-14 10:04:00', 'HONOR', 3),
    (100123, 'payment', '2022-05-14 10:10:00', 'HONOR', 4),
    (100125, 'login', '2022-05-15 11:00:00', 'XIAOMI', 1),
    (100125, 'visit', '2022-05-15 11:01:00', 'XIAOMI', 2),
    (100125, 'order', '2022-05-15 11:02:00', 'XIAOMI', 6),
    (100126, 'login', '2022-05-15 12:00:00', 'IPHONE', 1),
    (100126, 'visit', '2022-05-15 12:01:00', 'HONOR', 2),
    (100127, 'login', '2022-05-15 11:30:00', 'VIVO', 1),
    (100127, 'visit', '2022-05-15 11:31:00', 'VIVO', 5);

SELECT
    user_id,
    window_funnel(
        300,
        "default",
        event_timestamp,
        event_name = 'login',
        event_name = 'visit',
        event_name = 'order',
        event_name = 'payment'
    ) AS level
FROM
    events
GROUP BY
    user_id
order BY
    user_id;
```
```text
+---------+-------+
| user_id | level |
+---------+-------+
|  100123 |     3 |
|  100125 |     3 |
|  100126 |     2 |
|  100127 |     2 |
+---------+-------+
```
`user_id=100123`の場合、`payment`イベントが発生した時刻がタイムウィンドウを超えているため、マッチしたイベントチェーンは`login-visit-order`です。

### example2: deduplicationモード

`deduplication`モードを使用して、異なるuser_idに対応する連続イベントの最大数を見つけ出します。タイムウィンドウは1時間です：

```sql
CREATE TABLE events(
    user_id BIGINT,
    event_name VARCHAR(64),
    event_timestamp datetime,
    phone_brand varchar(64),
    tab_num int
) distributed by hash(user_id) buckets 3 properties("replication_num" = "1");

INSERT INTO
    events
VALUES
    (100123, 'login', '2022-05-14 10:01:00', 'HONOR', 1),
    (100123, 'visit', '2022-05-14 10:02:00', 'HONOR', 2),
    (100123, 'login', '2022-05-14 10:03:00', 'HONOR', 3),
    (100123, 'order', '2022-05-14 10:04:00', 'HONOR', 4),
    (100123, 'payment', '2022-05-14 10:10:00', 'HONOR', 4),
    (100125, 'login', '2022-05-15 11:00:00', 'XIAOMI', 1),
    (100125, 'visit', '2022-05-15 11:01:00', 'XIAOMI', 2),
    (100125, 'order', '2022-05-15 11:02:00', 'XIAOMI', 6),
    (100126, 'login', '2022-05-15 12:00:00', 'IPHONE', 1),
    (100126, 'visit', '2022-05-15 12:01:00', 'HONOR', 2),
    (100127, 'login', '2022-05-15 11:30:00', 'VIVO', 1),
    (100127, 'visit', '2022-05-15 11:31:00', 'VIVO', 5);

SELECT
    user_id,
    window_funnel(
        3600,
        "deduplication",
        event_timestamp,
        event_name = 'login',
        event_name = 'visit',
        event_name = 'order',
        event_name = 'payment'
    ) AS level
FROM
    events
GROUP BY
    user_id
order BY
    user_id;
```
```text
+---------+-------+
| user_id | level |
+---------+-------+
|  100123 |     2 |
|  100125 |     3 |
|  100126 |     2 |
|  100127 |     2 |
+---------+-------+
```
`user_id=100123`の場合、`visit`イベントのマッチング後に`login`イベントが繰り返し出現するため、マッチしたイベントチェーンは`login-visit`となります。

### example3: fixedモード

`fixed`モードを使用して、異なる`user_id`に対応する連続イベントの最大数を、時間ウィンドウ`1`時間で見つけ出します：

```sql
CREATE TABLE events(
    user_id BIGINT,
    event_name VARCHAR(64),
    event_timestamp datetime,
    phone_brand varchar(64),
    tab_num int
) distributed by hash(user_id) buckets 3 properties("replication_num" = "1");

INSERT INTO
    events
VALUES
    (100123, 'login', '2022-05-14 10:01:00', 'HONOR', 1),
    (100123, 'visit', '2022-05-14 10:02:00', 'HONOR', 2),
    (100123, 'login2', '2022-05-14 10:03:00', 'HONOR', 3),
    (100123, 'order', '2022-05-14 10:04:00', 'HONOR', 4),
    (100123, 'payment', '2022-05-14 10:10:00', 'HONOR', 4),
    (100125, 'login', '2022-05-15 11:00:00', 'XIAOMI', 1),
    (100125, 'visit', '2022-05-15 11:01:00', 'XIAOMI', 2),
    (100125, 'order', '2022-05-15 11:02:00', 'XIAOMI', 6),
    (100126, 'login', '2022-05-15 12:00:00', 'IPHONE', 1),
    (100126, 'visit', '2022-05-15 12:01:00', 'HONOR', 2),
    (100127, 'login', '2022-05-15 11:30:00', 'VIVO', 1),
    (100127, 'visit', '2022-05-15 11:31:00', 'VIVO', 5);

SELECT
    user_id,
    window_funnel(
        3600,
        "fixed",
        event_timestamp,
        event_name = 'login',
        event_name = 'visit',
        event_name = 'order',
        event_name = 'payment'
    ) AS level
FROM
    events
GROUP BY
    user_id
order BY
    user_id;
```
```text
+---------+-------+
| user_id | level |
+---------+-------+
|  100123 |     4 |
|  100125 |     3 |
|  100126 |     2 |
|  100127 |     2 |
+---------+-------+
```
`user_id=100123`の場合、`login2`はファンネル内のどの条件にも一致しません。Doris 4.1以降では、このような無関係なイベントは`fixed`チェーンを破ることがないため、マッチしたイベントチェーンは`login-visit-order-payment`となります。Doris 4.1より前のバージョンでは、同じデータは`login-visit`で停止し、レベル`2`を返します。

### example4: increaseモード

`increase`モードを使用して、異なる`user_id`に対応する連続イベントの最大数を、`1`時間のタイムウィンドウで見つけます：

```sql
CREATE TABLE events(
    user_id BIGINT,
    event_name VARCHAR(64),
    event_timestamp datetime,
    phone_brand varchar(64),
    tab_num int
) distributed by hash(user_id) buckets 3 properties("replication_num" = "1");

INSERT INTO
    events
VALUES
    (100123, 'login', '2022-05-14 10:01:00', 'HONOR', 1),
    (100123, 'visit', '2022-05-14 10:02:00', 'HONOR', 2),
    (100123, 'order', '2022-05-14 10:04:00', 'HONOR', 4),
    (100123, 'payment', '2022-05-14 10:04:00', 'HONOR', 4),
    (100125, 'login', '2022-05-15 11:00:00', 'XIAOMI', 1),
    (100125, 'visit', '2022-05-15 11:01:00', 'XIAOMI', 2),
    (100125, 'order', '2022-05-15 11:02:00', 'XIAOMI', 6),
    (100126, 'login', '2022-05-15 12:00:00', 'IPHONE', 1),
    (100126, 'visit', '2022-05-15 12:01:00', 'HONOR', 2),
    (100127, 'login', '2022-05-15 11:30:00', 'VIVO', 1),
    (100127, 'visit', '2022-05-15 11:31:00', 'VIVO', 5);

SELECT
    user_id,
    window_funnel(
        3600,
        "increase",
        event_timestamp,
        event_name = 'login',
        event_name = 'visit',
        event_name = 'order',
        event_name = 'payment'
    ) AS level
FROM
    events
GROUP BY
    user_id
order BY
    user_id;
```
```text
+---------+-------+
| user_id | level |
+---------+-------+
|  100123 |     3 |
|  100125 |     3 |
|  100126 |     2 |
|  100127 |     2 |
+---------+-------+
```
`user_id=100123`の場合、`payment`イベントのタイムスタンプと`order`イベントのタイムスタンプが同じ秒に発生し、インクリメントされないため、マッチしたイベントチェーンは`login-visit-order`です。
