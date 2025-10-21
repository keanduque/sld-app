async function createNetwork() {
  try {
    const response = await fetch("data2.json");
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

    const dataMain = await response.json();
    console.log("Raw data:", dataMain);

    const spliceClosures = dataMain.splice_closures || [];
    const feederCables = dataMain.feeder_cables || [];
    const opticalTaps = dataMain.optical_tap || [];
    const fibreCables = dataMain.fibre_cables || [];

    // --- 1️⃣ Base network (feeder + splice closures) ---
    const baseNodes = spliceClosures.map((item) => ({
      id: item.label,
      label: item.label,
      group: item.enc_type === "5" ? "OLT" : "SP",
      title: `Type: Splice Closure\nenc_type: ${item.enc_type}\nOLT: ${item.olt_name}`,
    }));

    const baseEdges = feederCables.map((cable) => ({
      from: cable.from,
      to: cable.to,
      label: cable.label,
      color: { color: "#7F8C8D" },
    }));

    const nodes = new vis.DataSet(baseNodes);
    const edges = new vis.DataSet(baseEdges);

    const container = document.getElementById("network");
    const data = { nodes, edges };

    const options = {
      groups: {
        OLT: { color: { background: "#FFA500" }, shape: "box" },
        SP: { color: { background: "#ADD8E6" }, shape: "ellipse" },
        OT: { color: { background: "#90EE90" }, shape: "triangle" },
        FibreEnd: { color: { background: "#D3D3D3" }, shape: "dot" },
      },

      edges: {
        arrows: "to",
        font: { align: "middle", size: 10 },

        // smooth: {
        //   enabled: true,
        //   type: "cubicBezier",
        //   roundness: 0.3,
        //   forceDirection: "horizontal",
        // },
      },
      layout: {
        hierarchical: {
          direction: "LR", // left to right
          sortMethod: "directed",
          shakeTowards: "roots",
          levelSeparation: 300, // vertical spacing between hierarchy levels
          nodeSpacing: 22, // horizontal spacing between sibling nodes
          treeSpacing: 15, // spacing between branches
          blockShifting: false,
          edgeMinimization: true,
          parentCentralization: false,
        },
      },
      physics: {
        enabled: true,
        hierarchicalRepulsion: {
          avoidOverlap: 1,
          centralGravity: 0.0,
          springLength: 200,
          springConstant: 0.01,
          nodeDistance: 150,
          damping: 0.09,
        },
        maxVelocity: 50,
        minVelocity: 0.1,
        solver: "barnesHut",
        stabilization: {
          enabled: true,
          iterations: 1000,
          updateInterval: 100,
          onlyDynamicEdges: false,
          fit: true,
        },
      },
      interaction: {
        tooltipDelay: 200,
        hideEdgesOnDrag: true,
        hideEdgesOnZoom: true,
      },
    };

    const network = new vis.Network(container, data, options);
    console.log("✅ Base network created successfully!");

    // --- 2️⃣ Track expanded state ---
    let expandedTreeNodes = new Set(); // nodes currently in the visible expanded tree
    let expandedTreeEdges = new Set();
    let rootExpandedNode = null;

    // --- 3️⃣ Helper: Recursive expansion ---
    function expandNodeRecursive(nodeId, visited = new Set()) {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const relatedFibres = fibreCables.filter((f) => f.from === nodeId);
      if (!relatedFibres.length) return;

      relatedFibres.forEach((fibre) => {
        // Add child node if missing
        if (!nodes.get(fibre.to)) {
          const relatedTap = opticalTaps.find((t) => t.label === fibre.to);
          nodes.add({
            id: fibre.to,
            label: fibre.to,
            group: relatedTap ? "OT" : "FibreEnd",
            title: relatedTap
              ? `Optical Tap\nOLT: ${relatedTap.olt_name}`
              : "Fibre endpoint",
          });
        }
        expandedTreeNodes.add(fibre.to);

        // Add edge if missing
        if (!edges.get(fibre.label)) {
          edges.add({
            id: fibre.label,
            from: fibre.from,
            to: fibre.to,
            label: fibre.label,
            color: { color: "#3498DB" },
            dashes: true,
          });
        }
        expandedTreeEdges.add(fibre.label);

        // Recurse further
        expandNodeRecursive(fibre.to, visited);
      });
    }

    // --- 4️⃣ Collapse entire expanded tree ---
    function collapseExpandedTree() {
      expandedTreeEdges.forEach((id) => {
        try {
          edges.remove(id);
        } catch (_) {}
      });
      expandedTreeNodes.forEach((id) => {
        try {
          // only remove nodes that are not base splice closures
          if (!spliceClosures.find((sc) => sc.label === id)) {
            nodes.remove(id);
          }
        } catch (_) {}
      });
      expandedTreeEdges.clear();
      expandedTreeNodes.clear();
    }

    // --- 5️⃣ Spinner overlay for heavy data ---
    const spinner = document.createElement("div");
    spinner.id = "spinner";
    spinner.style.cssText =
      "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,255,255,0.8);padding:20px 40px;border-radius:10px;font-family:sans-serif;font-size:14px;display:none;z-index:10;";
    spinner.innerText = "Loading network...";
    container.appendChild(spinner);

    function showSpinner() {
      spinner.style.display = "block";
    }
    function hideSpinner() {
      spinner.style.display = "none";
    }

    // --- 6️⃣ Handle clicks with smarter logic ---
    network.on("click", async (params) => {
      if (!params.nodes.length) return;
      const nodeId = params.nodes[0];
      console.log("Clicked node:", nodeId);

      // Update URL
      const url = new URL(window.location);
      url.searchParams.set("from_device", nodeId);
      window.history.pushState({}, "", url);

      // If clicked node already part of expanded tree → just expand deeper
      if (expandedTreeNodes.has(nodeId) || rootExpandedNode === nodeId) {
        showSpinner();
        expandNodeRecursive(nodeId);
        hideSpinner();
        return;
      }

      // Otherwise, clicked a new root → collapse and start new tree
      showSpinner();
      collapseExpandedTree();
      expandNodeRecursive(nodeId);
      hideSpinner();
      rootExpandedNode = nodeId;
      expandedTreeNodes.add(nodeId);
      console.log(`✨ Expanded branch from ${nodeId}`);
    });

    // --- 7️⃣ Auto-expand from URL param ---
    const urlParams = new URLSearchParams(window.location.search);
    const autoExpandId = urlParams.get("from_device");
    if (autoExpandId && nodes.get(autoExpandId)) {
      showSpinner();
      expandNodeRecursive(autoExpandId);
      hideSpinner();
      rootExpandedNode = autoExpandId;
      expandedTreeNodes.add(autoExpandId);
      network.focus(autoExpandId, { scale: 0.15 });
      console.log(`🌐 Auto-expanded from ${autoExpandId}`);
    }
  } catch (err) {
    console.error("❌ Error loading network:", err);
  }
}

document.addEventListener("DOMContentLoaded", createNetwork);
