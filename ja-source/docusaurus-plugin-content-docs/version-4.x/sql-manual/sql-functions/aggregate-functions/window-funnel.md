---
{
  "title": "WINDOW_FUNNEL",
  "language": "ja",
  "description": "WINDOWFUNNEL関数は、指定された時間窓内でイベントチェーンを検索し、最大値を計算することにより、ユーザー行動シーケンスを分析する"
}
---
## 説明

WINDOW_FUNNEL関数は、指定された時間ウィンドウ内でイベントチェーンを検索し、イベントチェーンで完了したステップの最大数を計算することで、ユーザー行動シーケンスを分析します。この関数は、Webサイト訪問から最終購入までのユーザーコンバージョンの分析など、コンバージョンファネル分析に特に有用です。

関数は次のアルゴリズムに従って動作します：

- 関数はチェーン内の最初の条件をトリガーするデータを検索し、イベントカウンターを1に設定します。これがスライディングウィンドウが開始される瞬間です。
- チェーンからのイベントがウィンドウ内で順次発生する場合、カウンターがインクリメントされます。イベントのシーケンスが中断された場合、カウンターはインクリメントされません。
- データに完了レベルが異なる複数のイベントチェーンがある場合、関数は最長チェーンのサイズのみを出力します。

## 構文

```sql
WINDOW_FUNNEL(<window>, <mode>, <timestamp>, <event_1>[, event_2, ... , event_n])
```
## パラメータ

| パラメータ | 説明 |
| -- | -- |
| `<window>` | windowは時間窓の長さを秒で指定 |
| `<mode>` | 合計4つのモードがあります：`default`、`deduplication`、`fixed`、`increase`。詳細については、以下の**Mode**を参照してください。 |
| `<timestamp>` | timestampはDATETIME型の列を指定し、スライディング時間窓がその上で動作します |
| `<event_n>` | evnet_nはeventID = 1004のようなブール式です |

**Mode**

    - `default`: 標準的なファネル計算。Dorisは時間窓内で指定された順序に一致する最長のイベントチェーンを検索します。いずれの条件にも一致しないイベントは無視されます。

    - `deduplication`: `default`をベースとしますが、現在のチェーンで既にマッチしたイベントは再度出現できません。例えば、条件リストが[event1='A', event2='B', event3='C', event4='D']で、元のイベントチェーンが`A-B-C-B-D`の場合、2番目の`B`がチェーンを破るため、マッチしたイベントチェーンは`A-B-C`となり、最大レベルは`3`になります。

    - `fixed`: チェーンは指定された順序で進行する必要があり、中間ステップをスキップできません。直前の条件がマッチする前に後の条件にマッチするイベントが現れた場合、チェーンは停止します。Doris 4.1以降では、いずれの条件にもマッチしないイベントは無視され、チェーンを破りません。例えば、[event1='A', event2='B', event3='C', event4='D']で、`A-B-D-C`は`A-B`を返してレベル`2`となります。`A-B-X-C-D`（`X`はいずれの条件にもマッチしない）では、Doris 4.1以降は`A-B-C-D`を返しますが、それ以前のバージョンでは`A-B`で停止します。

    - `increase`: `default`をベースとしますが、マッチしたイベントは厳密に増加するタイムスタンプを持つ必要があります。マッチした2つのイベントが同じタイムスタンプを持つ場合、後のイベントはチェーンを進められません。

## 戻り値
指定された時間窓内で完了した連続ステップの最大数を表す整数を返します。

## 例

### example1: defaultモード

`default`モードを使用して、時間窓`5`分で異なる`user_id`に対応する連続イベントの最大数を調べる：

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
`user_id=100123`の場合、`payment`イベントが発生した時間がタイムウィンドウを超えているため、マッチしたイベントチェーンは`login-visit-order`です。

### example2: deduplicationモード

`deduplication`モードを使用して、異なるuser_idに対応する連続イベントの最大数を1時間のタイムウィンドウで調べます：

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
`user_id=100123`の場合、`visit`イベントにマッチした後、`login`イベントが繰り返し現れるため、マッチしたイベントチェーンは`login-visit`です。

### example3: fixedモード

`fixed`モードを使用して、異なる`user_id`に対応する連続イベントの最大数を、`1`時間のタイムウィンドウで見つけ出します：

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
`user_id=100123`の場合、`login2`はファンネル内のいずれの条件にも一致しません。Doris 4.1以降では、このような無関係なイベントは`fixed`チェーンを中断しないため、一致したイベントチェーンは`login-visit-order-payment`になります。Doris 4.1より前のバージョンでは、同じデータは`login-visit`で停止し、レベル`2`を返します。

### example4: increaseモード

`increase`モードを使用して、異なる`user_id`に対応する連続イベントの最大数を調べます。時間ウィンドウは`1`時間です：

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
`user_id=100123`の場合、`payment`イベントのタイムスタンプと`order`イベントのタイムスタンプが同じ秒に発生し、増分されないため、マッチしたイベントチェーンは`login-visit-order`となります。
