#!/usr/bin/env node

// server.ts
import { randomUUID } from "crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer as McpServer3 } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";

// resources/component-detail.ts
import {
  ResourceTemplate
} from "@modelcontextprotocol/sdk/server/mcp.js";

// lib/wpds.ts
var COMPONENTS_MANIFEST_URL = "https://wordpress.github.io/gutenberg/manifests/components.json";
var ALLOWED_PACKAGES = ["@wordpress/components", "@wordpress/ui"];
function extractPackageName(importStatement) {
  const match = importStatement.match(/from\s+["']([^"']+)["']/);
  return match ? match[1] : null;
}
var cachedManifest = null;
async function getManifest() {
  if (cachedManifest) {
    return cachedManifest;
  }
  const response = await fetch(COMPONENTS_MANIFEST_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch components manifest: ${response.status} ${response.statusText}`
    );
  }
  const manifest = await response.json();
  cachedManifest = manifest;
  return manifest;
}
async function getComponents() {
  const manifest = await getManifest();
  const allComponents = Object.values(manifest.components);
  return allComponents.map((component) => {
    const packageName = component.import ? extractPackageName(component.import) : null;
    return {
      name: component.name,
      description: component.description || "",
      packageName
    };
  }).filter(
    (component) => component.packageName !== null && ALLOWED_PACKAGES.includes(component.packageName)
  );
}
async function getComponentDetail(name) {
  const manifest = await getManifest();
  const allComponents = Object.values(manifest.components);
  const component = allComponents.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  if (!component) {
    return null;
  }
  const packageName = component.import ? extractPackageName(component.import) : null;
  if (!packageName || !ALLOWED_PACKAGES.includes(packageName)) {
    return null;
  }
  const rawProps = component.reactDocgen?.props || {};
  const props = Object.entries(rawProps).map(
    ([propName, propInfo]) => {
      const description = propInfo.description || "";
      return {
        name: propName,
        type: propInfo.tsType?.name || "unknown",
        required: propInfo.required || false,
        description,
        defaultValue: propInfo.defaultValue?.value,
        deprecated: description.toLowerCase().includes("@deprecated") || description.toLowerCase().includes("@ignore")
      };
    }
  );
  return {
    name: component.name,
    description: component.description || "",
    packageName,
    importStatement: component.import,
    props,
    stories: component.stories || []
  };
}

// resources/component-detail.ts
function register(server2) {
  const template = new ResourceTemplate("wpds://components/{name}", {
    list: void 0
  });
  server2.registerResource(
    "component-detail",
    template,
    {
      description: "Detailed documentation for a WordPress Design System component including props, usage examples, and import statements",
      mimeType: "text/markdown"
    },
    async (uri, variables) => {
      const componentName = Array.isArray(variables.name) ? variables.name[0] : variables.name;
      const component = await getComponentDetail(componentName);
      if (!component) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: `# Component Not Found

No component named "${componentName}" was found in the WordPress Design System.`
            }
          ]
        };
      }
      const sections = [
        `# ${component.name}`,
        "",
        `**Package:** \`${component.packageName}\``
      ];
      if (component.description) {
        sections.push("", "## Description", "", component.description);
      }
      if (component.importStatement) {
        sections.push(
          "",
          "## Import",
          "",
          "```js",
          component.importStatement,
          "```"
        );
      }
      const props = component.props.filter((p) => !p.deprecated);
      if (props.length > 0) {
        sections.push("", "## Props", "");
        for (const prop of props) {
          const requiredBadge = prop.required ? " **(required)**" : "";
          const defaultNote = prop.defaultValue ? ` (default: \`${prop.defaultValue}\`)` : "";
          sections.push(
            `### \`${prop.name}\`: \`${prop.type}\`${requiredBadge}${defaultNote}`,
            ""
          );
          if (prop.description) {
            const cleanDesc = prop.description.replace(/@default\s+[^\n]+/gi, "").trim();
            if (cleanDesc) {
              sections.push(cleanDesc, "");
            }
          }
        }
      }
      if (component.stories.length > 0) {
        sections.push("", "## Examples", "");
        for (const story of component.stories) {
          sections.push(`### ${story.name}`);
          if (story.snippet) {
            sections.push("", "```jsx", story.snippet, "```");
          }
          sections.push("");
        }
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: sections.join("\n")
          }
        ]
      };
    }
  );
}

// resources/components.ts
function register2(server2) {
  server2.registerResource(
    "components",
    "wpds://components",
    {
      description: "Index of available components. For detailed docs, fetch wpds://components/{name}",
      mimeType: "text/markdown"
    },
    async () => {
      const components = await getComponents();
      const markdown = [
        "# WordPress Design System Components",
        "",
        "> For detailed documentation on any component, fetch `wpds://components/{component-name}`",
        "> Example: `wpds://components/Button`",
        "",
        'Available components listed below. Import using: `import { ComponentName } from "package-name";`',
        "",
        ...components.map(({ name, description, packageName }) => {
          const lines = [`## ${name}`, "", `**Package:** \`${packageName}\``];
          if (description) {
            lines.push("", description);
          }
          return lines.join("\n");
        })
      ].join("\n");
      return {
        contents: [
          {
            uri: "wpds://components",
            mimeType: "text/markdown",
            text: markdown
          }
        ]
      };
    }
  );
}

// resources/design-tokens.ts
var TOKENS_MD_URL = "https://raw.githubusercontent.com/WordPress/gutenberg/refs/heads/trunk/packages/theme/docs/tokens.md";
function register3(server2) {
  server2.registerResource(
    "design-tokens",
    "wpds://design-tokens",
    {
      description: "WordPress Design System design tokens reference (colors, spacing, typography, elevation, etc.)",
      mimeType: "text/markdown"
    },
    async () => {
      const response = await fetch(TOKENS_MD_URL);
      const text = await response.text();
      return {
        contents: [
          {
            uri: "wpds://design-tokens",
            mimeType: "text/markdown",
            text
          }
        ]
      };
    }
  );
}

// resources/page-detail.ts
import {
  ResourceTemplate as ResourceTemplate2
} from "@modelcontextprotocol/sdk/server/mcp.js";
function getSiteUrl() {
  return "https://system.automattic.design/";
}
async function fetchWordPressPageBySlug(siteUrl, slug) {
  const baseUrl = siteUrl.replace(/\/$/, "");
  const apiUrl = `${baseUrl}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&status=publish`;
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch page from ${siteUrl}: ${response.status} ${response.statusText}`
    );
  }
  const pages = await response.json();
  if (pages.length === 0) {
    return null;
  }
  return pages[0];
}
function register4(server2) {
  const template = new ResourceTemplate2("wpds://pages/{slug}", {
    list: void 0
  });
  server2.registerResource(
    "page-detail",
    template,
    {
      description: "Detailed information for a WordPress page including full content, metadata, and links",
      mimeType: "text/markdown"
    },
    async (uri, variables) => {
      const pageSlug = Array.isArray(variables.slug) ? variables.slug[0] : variables.slug;
      const siteUrl = getSiteUrl();
      const page = await fetchWordPressPageBySlug(siteUrl, pageSlug);
      if (!page) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: `# Page Not Found

No page with slug "${pageSlug}" was found in the WordPress site.`
            }
          ]
        };
      }
      const sections = [
        `# ${page.title.rendered}`,
        "",
        `**ID:** ${page.id}`,
        `**Slug:** \`${page.slug}\``,
        `**Link:** ${page.link}`,
        `**Date:** ${new Date(page.date).toLocaleDateString()}`,
        `**Last Modified:** ${new Date(page.modified).toLocaleDateString()}`
      ];
      if (page.template) {
        sections.push(`**Template:** \`${page.template}\``);
      }
      if (page.menu_order > 0) {
        sections.push(`**Menu Order:** ${page.menu_order}`);
      }
      if (page.excerpt?.rendered) {
        const excerpt = page.excerpt.rendered.replace(/<[^>]*>/g, "").trim();
        if (excerpt) {
          sections.push("", "## Excerpt", "", excerpt);
        }
      }
      if (page.content?.rendered) {
        sections.push("", "## Content", "");
        let content = page.content.rendered.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").trim();
        if (content) {
          sections.push(content);
        }
      }
      sections.push("", "## Metadata", "");
      sections.push(`**Status:** ${page.status}`);
      sections.push(`**Type:** ${page.type}`);
      sections.push(`**Author ID:** ${page.author}`);
      sections.push(`**Comment Status:** ${page.comment_status}`);
      sections.push(`**Ping Status:** ${page.ping_status}`);
      if (page.parent > 0) {
        sections.push(`**Parent ID:** ${page.parent}`);
      }
      if (page.featured_media > 0) {
        sections.push(`**Featured Media ID:** ${page.featured_media}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: sections.join("\n")
          }
        ]
      };
    }
  );
}

// resources/pages.ts
async function fetchWordPressPages(siteUrl) {
  const baseUrl = siteUrl.replace(/\/$/, "");
  const allPages = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;
  while (hasMore) {
    const apiUrl = `${baseUrl}/wp-json/wp/v2/pages?per_page=${perPage}&page=${page}&status=publish`;
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch pages from ${siteUrl}: ${response.status} ${response.statusText}`
      );
    }
    const pages = await response.json();
    allPages.push(...pages);
    const totalPages = parseInt(
      response.headers.get("X-WP-TotalPages") || "1",
      10
    );
    hasMore = page < totalPages;
    page++;
  }
  return allPages;
}
function getSiteUrl2() {
  return "https://system.automattic.design/";
}
function register5(server2) {
  server2.registerResource(
    "pages",
    "wpds://pages",
    {
      description: "All public pages from the design system reference site fetched via the REST API. For opening the full page content, fetch wpds://pages/{slug}",
      mimeType: "text/markdown"
    },
    async () => {
      const siteUrl = getSiteUrl2();
      const pages = await fetchWordPressPages(siteUrl);
      const markdown = [
        `# WordPress Pages from ${siteUrl}`,
        "",
        "> For detailed information on any page, fetch `wpds://pages/{page-slug}`",
        "> Example: `wpds://pages/getting-started`",
        "",
        `Found ${pages.length} public page(s).`,
        "",
        ...pages.map((page) => {
          const lines = [
            `## ${page.title.rendered}`,
            "",
            `**ID:** ${page.id}`,
            `**Slug:** \`${page.slug}\``,
            `**Link:** ${page.link}`,
            `**Date:** ${new Date(page.date).toLocaleDateString()}`
          ];
          if (page.excerpt?.rendered) {
            const excerpt = page.excerpt.rendered.replace(/<[^>]*>/g, "").trim();
            if (excerpt) {
              lines.push("", `**Excerpt:** ${excerpt}`);
            }
          }
          if (page.content?.rendered) {
            const content = page.content.rendered.replace(/<[^>]*>/g, "").trim().substring(0, 500);
            if (content) {
              lines.push(
                "",
                `**Content Preview:** ${content}${content.length === 500 ? "..." : ""}`
              );
            }
          }
          lines.push("", "---");
          return lines.join("\n");
        })
      ].join("\n");
      return {
        contents: [
          {
            uri: "wpds://pages",
            mimeType: "text/markdown",
            text: markdown
          }
        ]
      };
    }
  );
}

// resources/index.ts
var RESOURCES = [
  register2,
  register3,
  register,
  register4,
  register5
];
function registerAll(server2) {
  for (const register7 of RESOURCES) {
    register7(server2);
  }
}

// tools/start-design-system-task.ts
function register6(server2) {
  server2.registerTool(
    "start_design_system_task",
    {
      title: "Start Design System Task",
      description: "REQUIRED FIRST STEP for any WordPress Design System work."
    },
    async () => {
      const instructions = [
        "## IMPORTANT: Skills Document Available",
        "",
        "For the best results, make sure you have installed the WPDS skills for your agent."
      ].join("\n");
      return {
        content: [{ type: "text", text: instructions }]
      };
    }
  );
}

// tools/index.ts
var TOOLS = [register6];
function registerAll2(server2) {
  for (const register7 of TOOLS) {
    register7(server2);
  }
}

// server.ts
var args = process.argv.slice(2);
var useStdio = args.includes("--stdio");
var useHttp = args.includes("--http") || !useStdio;
var server = new McpServer3({
  name: "WPDS",
  version: "1.0.0",
  description: "A Model Context Protocol server for the WordPress Design System"
});
registerAll(server);
registerAll2(server);
if (useStdio) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else if (useHttp) {
  const app = createMcpExpressApp();
  const transports = {};
  app.use(
    cors({
      origin: true,
      exposedHeaders: ["mcp-session-id"],
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "mcp-session-id",
        "mcp-protocol-version"
      ]
    })
  );
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    let transport;
    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        }
      });
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32e3, message: "Bad request" },
        id: null
      });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32e3, message: "Session not found" },
        id: null
      });
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && transports[sessionId]) {
      await transports[sessionId].handleRequest(req, res);
      delete transports[sessionId];
    } else {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32e3, message: "Session not found" },
        id: null
      });
    }
  });
  const port = 3945;
  app.listen(port);
  console.log(`Server is running on port ${port} (HTTP transport)`);
}
