---
{
  "title": "AI概要",
  "language": "ja",
  "description": "AI技術が前例のないペースで進歩し続ける中、データインフラストラクチャは現代のAIアプリケーションの基盤となっています。"
}
---
<!-- 
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
-->


AI技術が前例のないペースで進歩し続ける中、データインフラストラクチャは現代のAIアプリケーションの基盤となっています。Apache Dorisは高性能なリアルタイム分析データベースとして、full-text search、vector search、AI functions、MCPベースのインテリジェントインタラクションのネイティブ統合を提供します。これらの機能が組み合わさることで、ストレージ、検索、分析を網羅する包括的なAIデータスタックを形成します。

- [full-text search](text-search/overview.md)
- [vector search](vector-search/overview.md)
- [AI functions](ai-function-overview.md)
- [Doris MCP サーバー](https://github.com/apache/doris-mcp-server)

Dorisは、hybrid searchと分析、agent facing data analysis、semantic search、RAGアプリケーション開発、大規模AIシステムの観測可能性など、幅広いAI主導のワークロードに対して統一された高性能でコスト効率の良いソリューションを提供します。

## エージェント Facing Analytics

AI エージェント技術の台頭により、ますます多くの分析判断がAIによって自動的に完了されるようになり、データプラットフォームには究極のリアルタイムパフォーマンスと高同時実行性能が求められています。従来の「手動分析」とは異なり、エージェント Facing Analyticsではデータクエリと意思決定がミリ秒スケールで完了する必要があり、大量のエージェントからの同時アクセスをサポートする必要があります。典型的なシナリオには、リアルタイム不正検知、インテリジェント広告配信、パーソナライズド推薦などがあります。

Dorisは高性能なMPPアーキテクチャにより、これらのagent facing分析シナリオで優れた優位性を実証しています：

- **Real-Time Ingestion & アップデート**: エージェントの判断が最新データに基づくことを保証し、最小データレイテンシー約1秒

- **Blazing-Fast Analytics**: 平均クエリレイテンシー100ms未満で、エージェントのリアルタイム判断要件を満たします
- **High-Concurrent Queries**: 10,000+ QPSをサポートし、大量のエージェント同時クエリを容易に処理します
- **Native エージェント integration**: MCP サーバーを通じてAI エージェントとシームレスに統合し、開発と統合ワークフローを簡素化します

## Hybrid Search and Analytics Processing

![img](/images/vector-search/image-5.png)

半構造化および非構造化データは、データ分析における第一級市民となっています。顧客レビュー、チャットログ、プロダクションログ、車両信号、その他のデータが、ビジネス意思決定プロセスに深く統合されています。従来の構造化分析ソリューションでは、full-text検索とvector search機能を組み込み、semantic searchをサポートしつつ、同じプラットフォームで多次元分析と集計統計を可能にする必要があります。例えば：

- **Customer insights**: レビューテキスト検索とユーザー行動分析を組み合わせて、顧客ニーズと満足度トレンドを正確に特定
- **Smart manufacturing**: プロダクションログのfull-text search、設備画像認識、IoTメトリクス分析を統合して、故障予測と品質最適化を実現
- **Internet of Vehicles**: 車両信号データ分析、ユーザーフィードバックテキストマイニング、運転行動vector検索を統合して、スマートコックピットエクスペリエンスを向上

上記のシナリオに対して、Dorisの高性能リアルタイム分析、テキストインデックス、vectorインデックス機能に基づいてAIアプリケーションを構築することで、複数の利点が得られます：

- **統一アーキテクチャ**: 構造化分析、full-text検索、vector searchを単一プラットフォームで処理し、データ移行と異種システム統合を排除
- **Hybridクエリパフォーマンス**: 単一SQLでvector類似度検索、キーワードフィルタリング、集計分析を同時実行し、優れたクエリパフォーマンスを実現
- **柔軟なスキーマサポート**: VARIANTタイプが動的JSON構造をネイティブサポート、Light Schema Changeが秒レベルのフィールドとインデックス変更を実現
- **Full-stackの最適化**: inverted indexesとvector indexesからMPP実行エンジンまでのエンドツーエンド最適化により、検索精度と分析効率のバランスを実現

## レイクハウス for AI

AIモデルとアプリケーション開発には、大規模データセットから学習セットの準備、feature engineering、データ品質評価が必要です。従来のアーキテクチャでは、データレイクと分析エンジン間で頻繁なデータ移行が必要でした。レイクハウスアーキテクチャは、データレイクのオープンストレージとリアルタイム分析エンジンを深く統合し、データ準備、feature engineering、モデル評価の全ワークフローを統一プラットフォームでサポートし、データサイロを排除してAI開発イテレーションを加速します。

- **レイクハウス統一アーキテクチャ**: オープンテーブルフォーマット（IcebergやPaimonなど）とCatalogsに基づいてオープンlakehouseを構築し、分析データとAIデータを統一管理
- **Real-Time Analytics Engine**: Dorisがリアルタイム分析エンジンとして機能し、インタラクティブクエリと軽量ETLをサポートし、データ準備とfeature engineeringに最高速のSQL計算能力を提供
- **シームレスなデータフロー**: データ移動なしでデータレイクを直接読み書きし、ストレージレイヤーでの統一管理とコンピュートレイヤーでの柔軟な高速化を実現

Dorisベースのレイクハウスアーキテクチャは、AI全体のワークフローを加速します：

- **大規模データ準備**: Dorisの効率的なデータ処理能力を活用して、PBスケールのデータレイクからデータのフィルタリング、サンプリング、クレンジングを行い、高品質な学習データセットを迅速に構築
- **リアルタイムfeature engineering**: Dorisのリアルタイム分析能力を活用してオンライン特徴抽出、変換、集計計算を実行し、モデル学習と推論にリアルタイム特徴サービスを提供
- **品質評価**: テストセットと本番データに対して多次元高速分析を実施し、モデルパフォーマンスとデータドリフトを継続的に監視

## RAG (Retrieval-Augmented Generation)

RAGは外部知識ベースから関連情報を検索して大規模モデルにコンテキストを提供し、モデルの幻覚と知識の通貨性の問題を効果的に解決します。vectorエンジンはRAGシステムのコアコンポーネントであり、大規模知識ベースから最も関連性の高い文書フラグメントを迅速に想起し、高同時実行ユーザークエリ要求をサポートしてアプリケーションの応答性を確保する必要があります。

- **Enterprise knowledge**: 内部文書とマニュアルに基づいてインテリジェントQ&Aシステムを構築し、従業員が自然言語を通じて正確な回答を迅速に取得可能にする
- **インテリジェントカスタマーサービスアシスタント**: プロダクト知識ベースと履歴ケースを組み合わせて、カスタマーサービス担当者やチャットボットに正確な応答提案を提供
- **インテリジェント文書アシスタント**: 大規模文書コレクション内の関連コンテンツを迅速に特定し、研究、執筆、意思決定プロセスを支援

これらのシナリオにおいて、DorisベースのRAGアプリケーション構築は以下の利点を提供します：

- **高同時実行パフォーマンス**: 分散アーキテクチャが高同時実行vector検索をサポートし、大規模同時ユーザーアクセスを容易に処理
- **Hybrid検索能力**: 単一SQLでvector類似度検索とキーワードフィルタリングを同時実行し、セマンティック想起と完全一致のバランスを実現
- **弾性スケーリング**: クラスター拡張に伴ってクエリパフォーマンスが線形にスケールし、数百万から数百億のvectorへとシームレスに移行
- **統一ソリューション**: vectorデータ、元文書、ビジネスデータを統一管理し、RAGアプリケーションのデータアーキテクチャを簡素化

## AI Observability

AIモデル学習イテレーションとアプリケーション運用は大量のログ、メトリクス、トレーシングデータを生成します。問題を正確に特定し継続的にパフォーマンスを最適化するため、観測可能性システムはAIインフラストラクチャの重要なコンポーネントとなっています。ビジネス規模の拡大に伴い、観測可能性プラットフォームはPBスケールデータの高スループット書き込み、ミリ秒レベルの検索応答、コスト制御など複数の課題に直面しています。典型的な使用例：

- **モデル学習監視**: 学習メトリクスとリソース消費をリアルタイム追跡し、学習異常とパフォーマンスボトルネックを迅速に特定
- **推論サービストレーシング**: 各推論要求の完全なtraceを記録し、レイテンシー源とエラーパターンを分析
- **AI****アプリケーションログ分析**: 大量のアプリケーションログのfull-text検索と集計分析を実行し、トラブルシューティングと行動インサイトをサポート

DorisによるAI Observability構築は以下の利点を提供します：

- **究極のパフォーマンス**: PB/日（10GB/s）の持続書き込みをサポート、inverted indexesがログ検索を加速し秒レベルで応答
- **コスト最適化**: 5:1から10:1の圧縮率、ストレージコスト50%-80%削減、コールドデータの低コストストレージをサポート
- **柔軟なスキーマ**: Light Schema Changeが秒レベルのフィールド変更を実現、VARIANTタイプが動的JSON構造をネイティブサポート
- **エコシステムフレンドリー**: OpenTelemetryとELKエコシステムと互換性があり、Grafana/Kibana可視化ツールとの統合をサポート

## Semantic Search

Semantic searchはベクトル化技術によってテキストの深い意味を捉えます。クエリ用語が文書の表現と異なる場合でも、意味的に関連するコンテンツを検索できます。これは、言語横断検索、同義語認識、意図理解などのシナリオにとって重要であり、検索想起率とユーザーエクスペリエンスを大幅に向上させます。典型的な使用例：

- **企業文書検索**: 従業員が自然言語で問題を記述し、システムが意図を理解して大量の文書から意味的に関連するポリシー、手順、知識を想起
- **Eコマース商品検索**: ユーザーが「夏に適した通気性の良い靴」と入力し、システムがニーズを理解して単なるキーワードマッチングではなく関連商品を想起
- **コンテンツ推薦**: 記事と動画の意味的類似性に基づくインテリジェント推薦により、異なる表現で潜在的に興味のあるコンテンツを発見

DorisベースのSemantic searchアプリケーション構築は以下の利点を提供します：

- **高性能vector検索**: HNSWとIVFアルゴリズムをサポート、億レベルのvectorに対して1秒未満で応答し、大規模semantic search要件を容易に処理
- **強化されたHybrid検索**: 単一SQLがSemantic searchとキーワードフィルタリングを統合し、必要な語彙ヒットを確保しながら意味的に関連するコンテンツを想起
- **マルチモーダル拡張**: テキストSemantic searchだけでなく、画像や音声などのマルチモーダルコンテンツのSemantic検索への拡張も可能
- **柔軟な量子化最適化**: SQ/PQ量子化技術により、検索精度を維持しながらストレージと計算コストを大幅に削減
