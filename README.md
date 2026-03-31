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

# Doris document website

This repo is for [Apache Doris Website](https://doris.apache.org)

And it use Github Action to automatically sync content from [Apache Doris Code Repo](https://github.com/apache/doris)

There are 2 Github Actions:

1. cron-deploy-website.yml

   It will sync at 01:00 AM everyday from Doris's master branch.

2. manual-deploy-website.yml

   It can only be triggered manually, and you can specify the branch name you want to sync.

## View the website

To view the website, navigate to 
[https://doris.apache.org](https://doris.apache.org)

## Run & Build Website

This website is built using [Docusaurus 2](https://docusaurus.io/), a modern static website generator.

### Installation

```
$ yarn
```

### Local Development

```
$ yarn start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

### Build

```
$ yarn build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

### Japanese Build Refresh

Japanese source content is maintained in `ja-source`, while the deploy workflows consume the generated static site in `ja-build`.

To refresh `ja-build` locally, run:

```
$ yarn refresh:ja-build
```

This command temporarily copies `ja-source` to `i18n/ja`, runs a multi-locale Docusaurus build for `en` and `ja`, extracts `build/ja` into `ja-build`, and then removes the temporary `i18n/ja` and `build` directories.

Do not replace `ja-build` with the output of a standalone `docusaurus build --locale ja`. That output uses root-level asset paths such as `/assets/...`, while the deployed Japanese site is served from `/ja` and must keep `/ja/assets/...` paths from `build/ja`.

The repository also includes a daily translation workflow that syncs changed English docs into `ja-source`. It translates changed files under `docs/` and `versioned_docs/`, syncs matching deletions, updates Japanese sidebar translation JSON, and opens an automated PR instead of pushing directly to `master`.

### Deployment

Using SSH:

```
$ USE_SSH=true yarn deploy
```

Not using SSH:

```
$ GIT_USER=<Your GitHub username> yarn deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.

# Modify the documentation

For how to submit pull requests, please refer to

- [How to Contribute](https://doris.apache.org/zh-CN/community/how-to-contribute/contribute-to-doris)

- [How to contribute docs](https://doris.apache.org/community/how-to-contribute/contribute-doc)

- [Docs Format Specification](https://doris.apache.org/community/how-to-contribute/docs-format-specification)

## Doris Website Directory Structure

```Plain
.
├── blog
│   ├── 1.1 Release.md
│   ├── Annoucing.md
│   ├── jd.md
│   ├── meituan.md
│   ├── release-note-0.15.0.md
│   ├── release-note-1.0.0.md
│   └── xiaomi.md
├── community
│   ├── design
│   │   ├── spark_load.md
│   │   ├── doris_storage_optimization.md
│   │   ├── grouping_sets_design.md
│   │   └── metadata-design.md
│   ├── ......
├── docs
│   ├── admin-manual
│   │   ├── cluster-management
│   │   ├── config
│   │   ├── data-admin
│   │   ├── http-actions
│   │   ├── maint-monitor
│   │   ├── privilege-ldap
│   │   ├── multi-tenant.md
│   │   ├── optimization.md
│   │   ├── query-profile.md
│   │   └── sql-interception.md
│   │   └── workload-group.md
│   ├── ......
├── i18n
│   └── zh-CN
│       ├── docusaurus-plugin-content-docs
│       │   ├── current
│       │   ├── version-1.2
│       │   ├── version-2.0
│       │   ├── version-2.1
│       │   ├── current.json
│       │   ├── version-1.2.json
│       │   ├── version-2.0.json
│       │   ├── version-2.1.json
│       ├── docusaurus-plugin-content-docs-community
│       └── local_build_docs.sh
├── src
│   ├── components
│   │   ├── Icons
│   │   ├── More
│   │   ├── PageBanner
│   │   └── PageColumn
│   ├── ......
├── static
│   ├── images
│   │   ├── Bloom_filter.svg.png
│   │   ├── .....
│   └── js
│       └── redirect.js
├── versioned_docs
│   ├── version-1.2
│   │   ├── admin-manual
│   │   ├── advanced
│   │   ├── benchmark
│   │   ├── data-operate
│   │   ├── data-table
│   │   ├── ecosystem
│   │   ├── faq
│   │   ├── get-starting
│   │   ├── install
│   │   ├── lakehouse
│   │   ├── query-acceleration
│   │   ├── releasenotes
│   │   └── sql-manual
│   └── version-2.0
│       ├── admin-manual
│       ├── benchmark
│       ├── data-operate
│       ├── db-connect
│       ├── ecosystem
│       ├── faq
│       ├── get-starting
│       ├── install
│       ├── lakehouse
│       ├── query
│       ├── releasenotes
│       ├── sql-manual
│       └── table-design
└── version-2.1
│       ├── admin-manual
│       ├── advanced
│       ├── benchmark
│       ├── data-operate
│       ├── data-table
│       ├── ecosystem
│       ├── faq
│       ├── get-starting
│       ├── install
│       ├── lakehouse
│       ├── query-acceleration
│       ├── releasenotes
│       └── sql-manual
├── versioned_sidebars
│   ├── version-1.2-sidebars.json
│   └── version-2.0-sidebars.json
│   └── version-2.1-sidebars.json
├── babel.config.js
├── build.sh
├── buildVersions.sh
├── docusaurus.config.js
├── package.json
├── README.md
├── sidebars.json
├── sidebarsCommunity.json
├── tree.out
├── tsconfig.json
├── versions.json
```

The following describes the directory structure of the Doris Website site so that users can easily find the corresponding directory and submit changes.

### 01 Blog Directory

The blog directory is located at `/blog`. All Blog Markdown should be placed in that directory. 

If you would like to share your technical insights, welcome to directly submitting a Blog PR or contacting dev@doris.apache.org.

### 02 Docs Directory

Here is the list of files if you need to submit docs changes:

1. **Markdown Files:** When you want to modify existing content or add new documents, you need to place them to the respective folders and both update Master branch and Version docs (2.1/2.0/1.2) .
2. **Sidebar Files:** These files control the directory structures. When adding new files or new directory, you should also update relative path in sidebar files that ensure the new document is displayed correctly in directory.  Currently, Master branch and other versions have separate sidebar files, including `sidebar.json, version-2.0-sidebars.json, and version-2.1-sidebars.json`.

Please make sure to update all the necessary files accordingly when modifying existing document content, adding new documents, or adding new directory sections.

The following are the detailed steps for explaining how and where modify the docs: 

**Updating Latest Version (Master Branch)**

**1. Update content**

This version is modified in the `/docs` directory

```Plain
.
├── docs
│   ├── admin-manual
│   ├── ......
```

**2. Update sidebar**

The docs directory structure of the latest version is edited by `sidebar.json`.

```Plain
.
├── docs
│   ├── admin-manua
│   ├── ......
├── i18n
├── src
├── static
├── versioned_docs
├── versioned_sidebars
├── sidebars.json
```

Whether add new docs to existing directory or new directory, you need to update the relative path of the added docs in `sidebar.json`.

```JSON
{
    "docs": [
            {
                "type": "category",
                "label": "Getting Started",
                "items": [
                    "get-starting/quick-start",
                    "get-starting/what-is-apache-doris"
                ]
            },
            {
                "type": "category",
                "label": "Install and Deploy",
                "items": [
                    "install/standard-deployment",
                    {
                        "type": "category",
                        "label": "Docker Deployment",
                        "items": [
                            "install/construct-docker/build-docker-image",
                            "install/construct-docker/run-docker-cluster"
                        ]
             }
             ......
         }
     ]
 }
```

**Updating Version 2.1/2.0/1.2**

**1. Update content**

- 2.1 version is modified in the `/versioned_docs/version-2.1` directory

- 2.0 version is modified in the `/versioned_docs / version-2.0`directory

- 1.2 version is modified in the `/versioned_docs / version-1.2` directory

```Plain
.
├── blog
├── community
├── docs
├── i18n
├── versioned_docs
│   ├── version-1.2
│   ├── version-2.0
│   ├── version-2.1
```

**2. Update sidbar**

The docs directory structure of the version docs is edited by `version-X.X-sidebar.json`.

```Plain
.
├── blog
├── community
├── docs
├── i18n
├── versioned_docs
├── versioned_sidebars
│   ├── version-1.2-sidebars.json
│   └── version-2.0-sidebars.json
│   └── version-2.1-sidebars.json
```

### 03 Community Docs Directory

If you want to modify the community docs, please go to `community/` directory. 

- For modifying the existing docs, please go to `community/` directory. 

- For updating community docs directory, please modify the `sidebarsCommunity.json` to include appropriate relative path for the new document. 

```Markdown
.
├── blog
├── community
│   ├── design
│   │   ├── spark_load.md
│   │   ├── doris_storage_optimization.md
│   │   ├── grouping_sets_design.md
│   │   └── metadata-design.md
│   ├── ......
│   ......
├── sidebarsCommunity.json
```

### 04 Images Directory

All images are located at `/static/images`.

You can display images in simple syntax: ` ![Alt text for images description](co-locate file structure or link) `

If the image file name consists of multiple English words, they should be separated by hyphens "-".
