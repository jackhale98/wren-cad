// Whittle kernel façade — M5 STEP AP242 PMI: what the file says beyond OCCT 8.0.1's XCAF reader
// (ADR-100 amendment, 2026-11-23). Read-only queries on the STEP model the reader loaded.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Part of the amalgamated façade translation unit (see whittle_core.cpp); not compiled alone.
//
// OCCT's GD&T reader (STEPCAFControl_Reader::ReadGDTs) attaches a datum to faces only through a
// GEOMETRIC_ITEM_SPECIFIC_USAGE of its datum feature and only when a tolerance references the
// datum; it drops an ITEM_IDENTIFIED_REPRESENTATION_USAGE whose identified item is a typed
// SET_REPRESENTATION_ITEM(...) (the parser leaves the item null); it reads no
// DRAUGHTING_CALLOUT_RELATIONSHIP (the entity stays undefined); it ignores the 'orientation' of a
// 'linear distance'; and it skips complex GD&T entities it has no class for. Everything here reads
// what the file states, entity by entity; nothing is inferred from geometry.

// The STEP model and transfer results of one import.
struct StepPmiModel {
  occ::handle<Interface_InterfaceModel> model;
  occ::handle<StepData_StepModel> stepModel;
  occ::handle<Transfer_TransientProcess> tp;
  occ::handle<XSControl_TransferReader> tr;
  std::string path;  // the STEP file in MEMFS (raw fallback for typed lists OCCT drops)
  // Raw entity text by file label, loaded on first need.
  bool rawLoaded = false;
  std::map<int, std::string> raw;
  std::map<int, occ::handle<Standard_Transient>> byLabel;

  bool valid() const { return !model.IsNull() && !tp.IsNull() && tp->HasGraph(); }
  const Interface_Graph& graph() const { return tp->Graph(); }
};

StepPmiModel stepPmiModel(STEPCAFControl_Reader& reader, const std::string& path) {
  StepPmiModel s;
  s.path = path;
  s.model = reader.ChangeReader().Model();
  s.stepModel = occ::down_cast<StepData_StepModel>(s.model);
  const occ::handle<XSControl_WorkSession> ws = reader.ChangeReader().WS();
  if (!ws.IsNull() && !ws->TransferReader().IsNull()) {
    s.tr = ws->TransferReader();
    s.tp = s.tr->TransientProcess();
  }
  return s;
}

std::string stepText(const occ::handle<TCollection_HAsciiString>& s) {
  return s.IsNull() ? std::string() : std::string(s->ToCString());
}

// --- Raw entity text (only for parameters the parser could not represent) ---------------------

// Loads "#n=...;" for the wanted labels in one pass over the file.
void loadRawEntities(StepPmiModel& s, const std::set<int>& wanted) {
  if (wanted.empty()) return;
  std::ifstream in(s.path, std::ios::binary);
  if (!in) return;
  std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  const size_t data = text.find("DATA;");
  size_t i = data == std::string::npos ? 0 : data + 5;
  const size_t n = text.size();
  while (i < n) {
    // Next statement start: '#' digits spaces '='.
    if (text[i] != '#') {
      ++i;
      continue;
    }
    size_t j = i + 1;
    int label = 0;
    while (j < n && text[j] >= '0' && text[j] <= '9' && label < 100000000) {
      label = label * 10 + (text[j] - '0');
      ++j;
    }
    size_t k = j;
    while (k < n && (text[k] == ' ' || text[k] == '\t' || text[k] == '\r' || text[k] == '\n')) ++k;
    if (j == i + 1 || k >= n || text[k] != '=') {
      i = j;
      continue;
    }
    // Body up to the ';' that is outside quotes.
    size_t e = k + 1;
    bool quoted = false;
    while (e < n) {
      const char c = text[e];
      if (c == '\'') quoted = !quoted;  // '' inside a string toggles twice: still inside
      else if (c == ';' && !quoted) break;
      ++e;
    }
    if (wanted.count(label) > 0) s.raw[label] = text.substr(k + 1, e - k - 1);
    i = e + 1;
  }
}

// The entity labels referenced inside top-level parameter `param` (0-based) of a simple entity
// `TYPE(p0, p1, …)`; empty for complex entities or when the text is not there.
std::vector<int> rawParamRefs(const std::string& body, size_t param) {
  std::vector<int> out;
  size_t open = body.find('(');
  if (open == std::string::npos) return out;
  for (size_t t = 0; t < open; ++t) {
    if (body[t] != ' ' && body[t] != '\t' && body[t] != '\r' && body[t] != '\n' &&
        !((body[t] >= 'A' && body[t] <= 'Z') || (body[t] >= '0' && body[t] <= '9') || body[t] == '_')) {
      return out;  // a complex entity starts with '(' (no type name before it)
    }
  }
  if (open == 0) return out;
  int depth = 0;
  size_t current = 0;
  bool quoted = false;
  for (size_t i = open + 1; i < body.size(); ++i) {
    const char c = body[i];
    if (c == '\'') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (c == '(') {
      ++depth;
    } else if (c == ')') {
      if (depth == 0) break;
      --depth;
    } else if (c == ',' && depth == 0) {
      ++current;
    } else if (c == '#' && current == param) {
      int label = 0;
      size_t j = i + 1;
      while (j < body.size() && body[j] >= '0' && body[j] <= '9' && label < 100000000) {
        label = label * 10 + (body[j] - '0');
        ++j;
      }
      if (j > i + 1) out.push_back(label);
      i = j - 1;
    }
  }
  return out;
}

occ::handle<Standard_Transient> stepEntityByLabel(StepPmiModel& s, int label) {
  if (s.byLabel.empty() && !s.stepModel.IsNull()) {
    for (int i = 1; i <= s.model->NbEntities(); ++i) {
      const occ::handle<Standard_Transient> e = s.model->Value(i);
      if (!e.IsNull()) s.byLabel[s.stepModel->IdentLabel(e)] = e;
    }
  }
  auto it = s.byLabel.find(label);
  return it == s.byLabel.end() ? occ::handle<Standard_Transient>() : it->second;
}

// --- Shapes of representation items and shape aspects ----------------------------------------

// The transferred shape of a representation item: the item's own result, else that of a
// topological item built on it (a curve or surface of an edge or face), as OCCT's GD&T reader
// does (FindShapeIndexForDGT).
TopoDS_Shape stepItemShape(const StepPmiModel& s, const occ::handle<Standard_Transient>& item) {
  if (item.IsNull()) return TopoDS_Shape();
  int index = s.tp->MapIndex(item);
  if (index <= 0) {
    for (Interface_EntityIterator it = s.graph().Sharings(item); it.More(); it.Next()) {
      if (it.Value()->IsKind(STANDARD_TYPE(StepShape_TopologicalRepresentationItem))) {
        index = s.tp->MapIndex(it.Value());
        if (index > 0) break;
      }
    }
  }
  if (index <= 0) return TopoDS_Shape();
  return TransferBRep::ShapeResult(s.tp->MapItem(index));
}

// The leaf shape aspects a shape aspect stands for: through derived shape aspects to what they
// derive from, through composite shape aspects to their members (OCCT's collectShapeAspect).
// Datum features and datum targets are leaves.
void collectStepAspects(const StepPmiModel& s, const occ::handle<StepRepr_ShapeAspect>& sa,
                        std::vector<occ::handle<StepRepr_ShapeAspect>>& out,
                        std::set<const Standard_Transient*>& seen) {
  if (sa.IsNull() || !seen.insert(sa.get()).second || seen.size() > 10000) return;
  if (sa->IsKind(STANDARD_TYPE(StepRepr_DerivedShapeAspect))) {
    for (Interface_EntityIterator it = s.graph().Sharings(sa); it.More(); it.Next()) {
      const occ::handle<StepRepr_ShapeAspectDerivingRelationship> sadr =
          occ::down_cast<StepRepr_ShapeAspectDerivingRelationship>(it.Value());
      if (!sadr.IsNull() && sadr->RelatingShapeAspect().get() == sa.get()) {
        collectStepAspects(s, sadr->RelatedShapeAspect(), out, seen);
        return;
      }
    }
    return;
  }
  if (sa->IsKind(STANDARD_TYPE(StepDimTol_DatumFeature)) ||
      sa->IsKind(STANDARD_TYPE(StepDimTol_DatumTarget))) {
    out.push_back(sa);
    return;
  }
  bool composite = false;
  for (Interface_EntityIterator it = s.graph().Sharings(sa); it.More(); it.Next()) {
    if (!it.Value()->IsKind(STANDARD_TYPE(StepRepr_ShapeAspectRelationship)) ||
        it.Value()->IsKind(STANDARD_TYPE(StepShape_DimensionalLocation))) {
      continue;
    }
    const occ::handle<StepRepr_ShapeAspectRelationship> sar =
        occ::down_cast<StepRepr_ShapeAspectRelationship>(it.Value());
    if (sar->RelatingShapeAspect().get() != sa.get() || sar->RelatedShapeAspect().IsNull() ||
        sar->RelatedShapeAspect()->IsKind(STANDARD_TYPE(StepDimTol_Datum))) {
      continue;
    }
    composite = true;
    collectStepAspects(s, sar->RelatedShapeAspect(), out, seen);
  }
  if (!composite) out.push_back(sa);
}

// Faces, edges or vertices a shape stands for (a wire's edges, a shell's faces).
void stepAtoms(const TopoDS_Shape& shape, std::vector<TopoDS_Shape>& out) {
  if (shape.IsNull()) return;
  switch (shape.ShapeType()) {
    case TopAbs_FACE:
    case TopAbs_EDGE:
    case TopAbs_VERTEX:
      out.push_back(shape);
      return;
    case TopAbs_WIRE:
      for (TopExp_Explorer ex(shape, TopAbs_EDGE); ex.More(); ex.Next()) out.push_back(ex.Current());
      return;
    default: {
      const size_t before = out.size();
      for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) out.push_back(ex.Current());
      if (out.size() == before) {
        for (TopExp_Explorer ex(shape, TopAbs_EDGE); ex.More(); ex.Next()) out.push_back(ex.Current());
      }
      return;
    }
  }
}

// Typed lists (SET_REPRESENTATION_ITEM((#a,#b))) come back from OCCT's parser as null items
// (ReadSubList finds the typed parameter, whose only member is the list, not an entity). The
// entities that hold one are read once from the file text.
bool hasNullItem(const occ::handle<Standard_Transient>& e) {
  const occ::handle<StepAP242_ItemIdentifiedRepresentationUsage> u =
      occ::down_cast<StepAP242_ItemIdentifiedRepresentationUsage>(e);
  if (!u.IsNull()) {
    if (u->NbIdentifiedItem() == 0) return true;
    for (int j = 1; j <= u->NbIdentifiedItem(); ++j) {
      if (u->IdentifiedItemValue(j).IsNull()) return true;
    }
    return false;
  }
  const occ::handle<StepRepr_CompoundRepresentationItem> c =
      occ::down_cast<StepRepr_CompoundRepresentationItem>(e);
  if (!c.IsNull()) {
    const occ::handle<NCollection_HArray1<occ::handle<StepRepr_RepresentationItem>>> items = c->ItemElement();
    if (items.IsNull() || items->Length() == 0) return true;
    for (int j = items->Lower(); j <= items->Upper(); ++j) {
      if (items->Value(j).IsNull()) return true;
    }
  }
  return false;
}

// Entities referenced inside top-level parameter `param` of `e`, read from the file text.
std::vector<occ::handle<Standard_Transient>> rawParamEntities(StepPmiModel& s,
                                                             const occ::handle<Standard_Transient>& e,
                                                             size_t param) {
  std::vector<occ::handle<Standard_Transient>> out;
  if (s.stepModel.IsNull()) return out;
  if (!s.rawLoaded) {
    std::set<int> wanted;
    for (int i = 1; i <= s.model->NbEntities(); ++i) {
      const occ::handle<Standard_Transient> x = s.model->Value(i);
      if (!x.IsNull() && hasNullItem(x)) wanted.insert(s.stepModel->IdentLabel(x));
    }
    loadRawEntities(s, wanted);
    s.rawLoaded = true;
  }
  auto it = s.raw.find(s.stepModel->IdentLabel(e));
  if (it == s.raw.end()) return out;
  for (int ref : rawParamRefs(it->second, param)) {
    const occ::handle<Standard_Transient> x = stepEntityByLabel(s, ref);
    if (!x.IsNull()) out.push_back(x);
  }
  return out;
}

// The items an item_identified_representation_usage names. A typed list
// (SET_REPRESENTATION_ITEM((#a,#b))) comes back from OCCT's parser as one null item; it is then
// read from the file text.
std::vector<occ::handle<Standard_Transient>> stepUsageItems(
    StepPmiModel& s, const occ::handle<StepAP242_ItemIdentifiedRepresentationUsage>& usage) {
  std::vector<occ::handle<Standard_Transient>> items;
  bool missing = false;
  for (int j = 1; j <= usage->NbIdentifiedItem(); ++j) {
    const occ::handle<StepRepr_RepresentationItem> item = usage->IdentifiedItemValue(j);
    if (item.IsNull()) {
      missing = true;
    } else {
      items.push_back(item);
    }
  }
  if (missing || usage->NbIdentifiedItem() == 0) {
    const std::vector<occ::handle<Standard_Transient>> raw = rawParamEntities(s, usage, 4);
    if (!raw.empty()) items = raw;
  }
  return items;
}

// Faces, edges and vertices a shape aspect identifies in the file, through every
// item_identified_representation_usage (geometric_item_specific_usage included) of its leaves.
// `datumTargets` collects the leaves that are datum targets (not resolved to shapes).
std::vector<TopoDS_Shape> stepAspectShapes(
    StepPmiModel& s, const occ::handle<StepRepr_ShapeAspect>& sa,
    std::vector<occ::handle<StepDimTol_DatumTarget>>* datumTargets = nullptr) {
  std::vector<TopoDS_Shape> out;
  std::vector<occ::handle<StepRepr_ShapeAspect>> leaves;
  std::set<const Standard_Transient*> seen;
  collectStepAspects(s, sa, leaves, seen);
  for (const occ::handle<StepRepr_ShapeAspect>& leaf : leaves) {
    if (leaf->IsKind(STANDARD_TYPE(StepDimTol_DatumTarget))) {
      if (datumTargets != nullptr) {
        datumTargets->push_back(occ::down_cast<StepDimTol_DatumTarget>(leaf));
      }
      continue;
    }
    for (Interface_EntityIterator it = s.graph().Sharings(leaf); it.More(); it.Next()) {
      const occ::handle<StepAP242_ItemIdentifiedRepresentationUsage> usage =
          occ::down_cast<StepAP242_ItemIdentifiedRepresentationUsage>(it.Value());
      // Draughting model item associations (also usages) link presentation, not geometry.
      if (usage.IsNull() || usage->IsKind(STANDARD_TYPE(StepAP242_DraughtingModelItemAssociation)) ||
          usage->Definition().Value().get() != leaf.get()) {
        continue;
      }
      for (const occ::handle<Standard_Transient>& item : stepUsageItems(s, usage)) {
        stepAtoms(stepItemShape(s, item), out);
      }
    }
  }
  return out;
}

// --- Presentation links -----------------------------------------------------------------------

// Callouts that present a semantic entity ("PMI representation to presentation link", or any
// draughting_model_item_association when `anyLink`).
std::vector<occ::handle<Standard_Transient>> stepCalloutsOf(const StepPmiModel& s,
                                                           const occ::handle<Standard_Transient>& ent,
                                                           bool anyLink) {
  std::vector<occ::handle<Standard_Transient>> out;
  for (Interface_EntityIterator it = s.graph().Sharings(ent); it.More(); it.Next()) {
    const occ::handle<StepAP242_DraughtingModelItemAssociation> dmia =
        occ::down_cast<StepAP242_DraughtingModelItemAssociation>(it.Value());
    if (dmia.IsNull() || dmia->Definition().Value().get() != ent.get()) continue;
    if (!anyLink) {
      TCollection_AsciiString name(stepText(dmia->Name()).c_str());
      name.LowerCase();
      if (name.Search("pmi representation to presentation link") < 0) continue;
    }
    for (int j = 1; j <= dmia->NbIdentifiedItem(); ++j) {
      const occ::handle<StepRepr_RepresentationItem> item = dmia->IdentifiedItemValue(j);
      if (!item.IsNull()) out.push_back(item);
    }
  }
  return out;
}

// The semantic entities (definitions of draughting_model_item_associations) a callout presents.
std::vector<occ::handle<Standard_Transient>> stepDefinitionsOf(const StepPmiModel& s,
                                                              const occ::handle<Standard_Transient>& callout) {
  std::vector<occ::handle<Standard_Transient>> out;
  for (Interface_EntityIterator it = s.graph().Sharings(callout); it.More(); it.Next()) {
    const occ::handle<StepAP242_DraughtingModelItemAssociation> dmia =
        occ::down_cast<StepAP242_DraughtingModelItemAssociation>(it.Value());
    if (dmia.IsNull()) continue;
    bool presents = false;
    for (int j = 1; j <= dmia->NbIdentifiedItem() && !presents; ++j) {
      presents = dmia->IdentifiedItemValue(j).get() == callout.get();
    }
    const occ::handle<Standard_Transient> def = dmia->Definition().Value();
    if (presents && !def.IsNull()) out.push_back(def);
  }
  return out;
}

// Callouts a DRAUGHTING_CALLOUT_RELATIONSHIP links to `callout` (either end). OCCT 8.0.1 has no
// class for the entity: it is an undefined entity whose parameters 3 and 4 are the callouts.
std::vector<occ::handle<Standard_Transient>> stepRelatedCallouts(const StepPmiModel& s,
                                                                const occ::handle<Standard_Transient>& callout) {
  std::vector<occ::handle<Standard_Transient>> out;
  for (Interface_EntityIterator it = s.graph().Sharings(callout); it.More(); it.Next()) {
    const occ::handle<StepData_UndefinedEntity> u =
        occ::down_cast<StepData_UndefinedEntity>(it.Value());
    if (u.IsNull() || u->IsComplex()) continue;
    const char* type = u->StepType();
    if (type == nullptr || std::strcmp(type, "DRAUGHTING_CALLOUT_RELATIONSHIP") != 0) continue;
    const occ::handle<Interface_UndefinedContent> c = u->UndefinedContent();
    if (c.IsNull() || c->NbParams() < 4 || !c->IsParamEntity(3) || !c->IsParamEntity(4)) continue;
    const occ::handle<Standard_Transient> a = c->ParamEntity(3);
    const occ::handle<Standard_Transient> b = c->ParamEntity(4);
    if (a.get() == callout.get() && !b.IsNull()) out.push_back(b);
    if (b.get() == callout.get() && !a.IsNull()) out.push_back(a);
  }
  return out;
}

// The name of the first callout presenting an entity (what the user sees the annotation as).
std::string stepPresentationName(const StepPmiModel& s, const occ::handle<Standard_Transient>& ent) {
  for (const occ::handle<Standard_Transient>& c : stepCalloutsOf(s, ent, false)) {
    const occ::handle<StepRepr_RepresentationItem> item =
        occ::down_cast<StepRepr_RepresentationItem>(c);
    if (!item.IsNull() && !stepText(item->Name()).empty()) return stepText(item->Name());
  }
  return std::string();
}

bool isStepGdtEntity(const occ::handle<Standard_Transient>& e) {
  return !e.IsNull() && (e->IsKind(STANDARD_TYPE(StepDimTol_GeometricTolerance)) ||
                         e->IsKind(STANDARD_TYPE(StepShape_DimensionalSize)) ||
                         e->IsKind(STANDARD_TYPE(StepShape_DimensionalLocation)));
}

// Shapes a tolerance or a size dimension applies to. A location dimension has two sides, so a
// datum attached to one has no single feature: empty.
std::vector<TopoDS_Shape> stepGdtShapes(StepPmiModel& s, const occ::handle<Standard_Transient>& e) {
  if (e.IsNull()) return {};
  if (e->IsKind(STANDARD_TYPE(StepDimTol_GeometricTolerance))) {
    const occ::handle<StepDimTol_GeometricTolerance> tol =
        occ::down_cast<StepDimTol_GeometricTolerance>(e);
    const occ::handle<Standard_Transient> target = tol->TolerancedShapeAspect().Value();
    if (!target.IsNull() && target->IsKind(STANDARD_TYPE(StepRepr_ShapeAspect))) {
      return stepAspectShapes(s, occ::down_cast<StepRepr_ShapeAspect>(target));
    }
    if (!target.IsNull() && target->IsKind(STANDARD_TYPE(StepShape_DimensionalSize))) {
      return stepGdtShapes(s, target);
    }
    return {};
  }
  if (e->IsKind(STANDARD_TYPE(StepShape_DimensionalSize))) {
    return stepAspectShapes(s, occ::down_cast<StepShape_DimensionalSize>(e)->AppliesTo());
  }
  return {};
}

std::set<const TopoDS_TShape*> tshapeSet(const std::vector<TopoDS_Shape>& shapes) {
  std::set<const TopoDS_TShape*> out;
  for (const TopoDS_Shape& sh : shapes) out.insert(sh.TShape().get());
  return out;
}

// --- Datums -----------------------------------------------------------------------------------

struct StepDatumInfo {
  std::string label;
  std::vector<TopoDS_Shape> shapes;  // the datum feature's faces (empty: none in the file)
  // How the faces were found: the feature's own usage, or the tolerance or dimension the datum
  // feature symbol is attached to in the presentation.
  std::string via;
  bool hasFeature = false;    // a datum feature (not only datum targets)
  bool ambiguous = false;     // two presentation links name different faces
  std::vector<std::string> targets;  // datum target ids (C1, …)
  bool presented = false;     // the datum feature has a presentation callout
  std::string name;           // that callout's name
  occ::handle<StepRepr_ShapeAspect> presentedFeature;  // the datum feature that callout presents
};

// Every datum the file defines, by label, in file order.
std::vector<StepDatumInfo> stepDatums(StepPmiModel& s) {
  std::vector<StepDatumInfo> out;
  if (!s.valid()) return out;
  for (int i = 1; i <= s.model->NbEntities(); ++i) {
    const occ::handle<StepDimTol_Datum> datum = occ::down_cast<StepDimTol_Datum>(s.model->Value(i));
    if (datum.IsNull()) continue;
    const std::string label = stepText(datum->Identification());
    auto found = std::find_if(out.begin(), out.end(),
                              [&](const StepDatumInfo& d) { return d.label == label; });
    if (found == out.end()) {
      out.push_back(StepDatumInfo{});
      out.back().label = label;
      found = out.end() - 1;
    }
    StepDatumInfo& info = *found;
    for (Interface_EntityIterator it = s.graph().Sharings(datum); it.More(); it.Next()) {
      if (it.Value()->IsKind(STANDARD_TYPE(StepShape_DimensionalLocation))) continue;
      const occ::handle<StepRepr_ShapeAspectRelationship> sar =
          occ::down_cast<StepRepr_ShapeAspectRelationship>(it.Value());
      if (sar.IsNull() || sar->RelatedShapeAspect().get() != datum.get() ||
          sar->RelatingShapeAspect().IsNull()) {
        continue;
      }
      const occ::handle<StepRepr_ShapeAspect> feature = sar->RelatingShapeAspect();
      std::vector<occ::handle<StepDimTol_DatumTarget>> targets;
      std::vector<TopoDS_Shape> shapes = stepAspectShapes(s, feature, &targets);
      for (const occ::handle<StepDimTol_DatumTarget>& t : targets) {
        info.targets.push_back(label + stepText(t->TargetId()));
      }
      if (feature->IsKind(STANDARD_TYPE(StepDimTol_DatumTarget))) continue;
      info.hasFeature = true;
      const std::vector<occ::handle<Standard_Transient>> callouts = stepCalloutsOf(s, feature, false);
      info.presented = info.presented || !callouts.empty();
      if (info.name.empty()) info.name = stepPresentationName(s, feature);
      if (info.presentedFeature.IsNull() && !callouts.empty()) info.presentedFeature = feature;
      if (!shapes.empty()) {
        if (info.shapes.empty()) {
          info.shapes = shapes;
          info.via = "feature";
        }
        continue;
      }
      // No faces on the feature itself: the presentation may tie the datum feature symbol to
      // faces (a shape aspect associated with the symbol's callout) or attach it to a tolerance
      // or a size dimension whose feature it is. Both are what the file states; if they name
      // different faces, nothing is chosen.
      std::vector<TopoDS_Shape> byAspect;
      std::vector<TopoDS_Shape> byAttachment;
      for (const occ::handle<Standard_Transient>& callout : callouts) {
        for (const occ::handle<Standard_Transient>& def : stepDefinitionsOf(s, callout)) {
          if (def.get() == feature.get() || !def->IsKind(STANDARD_TYPE(StepRepr_ShapeAspect)) ||
              def->IsKind(STANDARD_TYPE(StepDimTol_DatumFeature)) ||
              def->IsKind(STANDARD_TYPE(StepDimTol_Datum)) ||
              def->IsKind(STANDARD_TYPE(StepDimTol_DatumTarget)) || isStepGdtEntity(def)) {
            continue;
          }
          const std::vector<TopoDS_Shape> sh =
              stepAspectShapes(s, occ::down_cast<StepRepr_ShapeAspect>(def));
          byAspect.insert(byAspect.end(), sh.begin(), sh.end());
        }
        for (const occ::handle<Standard_Transient>& other : stepRelatedCallouts(s, callout)) {
          for (const occ::handle<Standard_Transient>& def : stepDefinitionsOf(s, other)) {
            if (!isStepGdtEntity(def)) continue;
            const std::vector<TopoDS_Shape> sh = stepGdtShapes(s, def);
            byAttachment.insert(byAttachment.end(), sh.begin(), sh.end());
          }
        }
      }
      if (!byAspect.empty() && !byAttachment.empty() &&
          tshapeSet(byAspect) != tshapeSet(byAttachment)) {
        info.ambiguous = true;
        continue;
      }
      if (info.shapes.empty() && !byAspect.empty()) {
        info.shapes = byAspect;
        info.via = "presentation";
      } else if (info.shapes.empty() && !byAttachment.empty()) {
        info.shapes = byAttachment;
        info.via = "attachment";
      }
    }
  }
  return out;
}

// --- Dimensions -------------------------------------------------------------------------------

struct StepDimensionInfo {
  occ::handle<Standard_Transient> entity;
  bool location = false;
  std::string type;   // the entity's name ('linear distance', 'diameter', …) or "angle"
  std::string name;   // the presenting callout's name
  bool hasValue = false;
  bool hasOrientation = false;
  gp_Dir orientation;
  std::set<const TopoDS_TShape*> first;
  std::set<const TopoDS_TShape*> second;
  // Dimension modifiers ('controlled radius', …) of a compound_representation_item OCCT could
  // not parse (a typed SET_REPRESENTATION_ITEM list).
  std::vector<std::string> unparsedModifiers;
  bool used = false;
};

std::vector<StepDimensionInfo> stepDimensions(StepPmiModel& s) {
  std::vector<StepDimensionInfo> out;
  if (!s.valid()) return out;
  for (int i = 1; i <= s.model->NbEntities(); ++i) {
    const occ::handle<Standard_Transient> e = s.model->Value(i);
    if (e.IsNull()) continue;
    StepDimensionInfo d;
    d.entity = e;
    if (e->IsKind(STANDARD_TYPE(StepShape_DimensionalSize))) {
      const occ::handle<StepShape_DimensionalSize> size = occ::down_cast<StepShape_DimensionalSize>(e);
      d.type = stepText(size->Name());
      if (e->IsKind(STANDARD_TYPE(StepShape_AngularSize))) d.type = "angle";
      d.first = tshapeSet(stepAspectShapes(s, size->AppliesTo()));
    } else if (e->IsKind(STANDARD_TYPE(StepShape_DimensionalLocation))) {
      const occ::handle<StepShape_DimensionalLocation> loc =
          occ::down_cast<StepShape_DimensionalLocation>(e);
      d.location = true;
      d.type = stepText(loc->Name());
      if (e->IsKind(STANDARD_TYPE(StepShape_AngularLocation))) d.type = "angle";
      d.first = tshapeSet(stepAspectShapes(s, loc->RelatingShapeAspect()));
      d.second = tshapeSet(stepAspectShapes(s, loc->RelatedShapeAspect()));
    } else {
      continue;
    }
    d.name = stepPresentationName(s, e);
    for (Interface_EntityIterator it = s.graph().Sharings(e); it.More(); it.Next()) {
      const occ::handle<StepShape_DimensionalCharacteristicRepresentation> dcr =
          occ::down_cast<StepShape_DimensionalCharacteristicRepresentation>(it.Value());
      if (dcr.IsNull() || dcr->Representation().IsNull()) continue;
      const occ::handle<StepShape_ShapeDimensionRepresentation> sdr = dcr->Representation();
      for (int j = 1; j <= sdr->NbItems(); ++j) {
        const occ::handle<StepRepr_RepresentationItem> item = sdr->ItemsValue(j);
        if (item.IsNull()) continue;
        if (item->IsKind(STANDARD_TYPE(StepRepr_ReprItemAndMeasureWithUnit)) ||
            item->IsKind(STANDARD_TYPE(StepRepr_ReprItemAndMeasureWithUnitAndQRI))) {
          d.hasValue = true;
        }
        if (item->IsKind(STANDARD_TYPE(StepRepr_CompoundRepresentationItem)) && hasNullItem(item)) {
          for (const occ::handle<Standard_Transient>& m : rawParamEntities(s, item, 1)) {
            const occ::handle<StepRepr_DescriptiveRepresentationItem> dri =
                occ::down_cast<StepRepr_DescriptiveRepresentationItem>(m);
            if (!dri.IsNull() && !stepText(dri->Description()).empty()) {
              d.unparsedModifiers.push_back(stepText(dri->Description()));
            }
          }
        }
        const occ::handle<StepGeom_Axis2Placement3d> ax = occ::down_cast<StepGeom_Axis2Placement3d>(item);
        if (!ax.IsNull() && stepText(ax->Name()) == "orientation") {
          // CAx-IF: the measuring direction is the placement's ref_direction (OCCT's reader reads
          // the same member).
          occ::handle<StepGeom_Direction> dir;
          if (ax->HasRefDirection()) dir = ax->RefDirection();
          if (!dir.IsNull() && dir->NbDirectionRatios() >= 2) {
            const std::array<double, 3>& r = dir->DirectionRatios();
            const gp_XYZ v(r[0], r[1], dir->NbDirectionRatios() >= 3 ? r[2] : 0.0);
            if (v.Modulus() > 1e-12) {
              d.orientation = gp_Dir(v);
              d.hasOrientation = true;
            }
          }
        }
      }
    }
    out.push_back(std::move(d));
  }
  return out;
}

// --- Tolerances -------------------------------------------------------------------------------

struct StepToleranceInfo {
  occ::handle<StepDimTol_GeometricTolerance> entity;
  std::set<const TopoDS_TShape*> shapes;
  bool hasProjected = false;
  double projected = 0.0;  // mm
  bool used = false;
};

// A length measure in mm (STEPConstruct_UnitContext with default factors: the cascade unit is the
// millimetre).
bool stepLengthMm(const occ::handle<StepBasic_MeasureWithUnit>& m, double& mm) {
  if (m.IsNull() || m->UnitComponent().IsNull()) return false;
  const occ::handle<StepBasic_NamedUnit> unit = m->UnitComponent().NamedUnit();
  if (unit.IsNull()) return false;
  STEPConstruct_UnitContext units;
  if (units.ComputeFactors(unit) != 0 || !units.LengthDone()) return false;
  mm = m->ValueComponent() * units.LengthFactor();
  return std::isfinite(mm);
}

// Tolerances in file order with what the XCAF reader gets wrong: the projected zone height
// (OCCT 8.0.1 scales it by its cascade unit, unlike the zone value).
std::vector<StepToleranceInfo> stepTolerances(StepPmiModel& s) {
  std::vector<StepToleranceInfo> out;
  if (!s.valid()) return out;
  for (int i = 1; i <= s.model->NbEntities(); ++i) {
    const occ::handle<StepDimTol_GeometricTolerance> tol =
        occ::down_cast<StepDimTol_GeometricTolerance>(s.model->Value(i));
    if (tol.IsNull()) continue;
    StepToleranceInfo t;
    t.entity = tol;
    t.shapes = tshapeSet(stepGdtShapes(s, tol));
    for (Interface_EntityIterator it = s.graph().Sharings(tol); it.More(); it.Next()) {
      if (!it.Value()->IsKind(STANDARD_TYPE(StepDimTol_ToleranceZone))) continue;
      for (Interface_EntityIterator z = s.graph().Sharings(it.Value()); z.More(); z.Next()) {
        const occ::handle<StepDimTol_ProjectedZoneDefinition> pz =
            occ::down_cast<StepDimTol_ProjectedZoneDefinition>(z.Value());
        double mm = 0.0;
        if (!pz.IsNull() && stepLengthMm(pz->ProjectionLength(), mm) && mm > 0) {
          t.hasProjected = true;
          t.projected = mm;
        }
      }
    }
    out.push_back(std::move(t));
  }
  return out;
}

// --- GD&T entities OCCT has no class for ------------------------------------------------------

struct StepUnreadEntity {
  std::string kind;   // "tolerance" | "dimension"
  std::string type;   // e.g. "flatness"
  std::string stepType;  // e.g. "FLATNESS_TOLERANCE"
  std::string name;
  std::string why;    // the parts OCCT does not know
  // A tolerance's own fields (GEOMETRIC_TOLERANCE part: name, description, magnitude, toleranced
  // shape aspect), and whether it has a datum reference frame.
  occ::handle<Standard_Transient> magnitude;
  occ::handle<Standard_Transient> aspect;
  bool datumReference = false;
};

std::string lowerWords(std::string s) {
  for (char& c : s) {
    if (c == '_') c = ' ';
    else if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return s;
}

std::string unquoteStep(const std::string& s) {
  if (s.size() >= 2 && s.front() == '\'' && s.back() == '\'') return s.substr(1, s.size() - 2);
  return s;
}

// Complex entities with a GEOMETRIC_TOLERANCE or DIMENSIONAL_* part that the parser left
// undefined (the reader skips them; they would otherwise vanish without a trace).
std::vector<StepUnreadEntity> stepUnreadGdt(const StepPmiModel& s) {
  std::vector<StepUnreadEntity> out;
  if (s.model.IsNull()) return out;
  for (int i = 1; i <= s.model->NbEntities(); ++i) {
    occ::handle<StepData_UndefinedEntity> u = occ::down_cast<StepData_UndefinedEntity>(s.model->Value(i));
    if (u.IsNull() || u->IsSub()) continue;
    StepUnreadEntity unread;
    std::vector<std::string> parts;
    bool gdt = false;
    for (occ::handle<StepData_UndefinedEntity> p = u; !p.IsNull(); p = p->Next()) {
      const std::string type = p->StepType() != nullptr ? p->StepType() : "";
      parts.push_back(type);
      const occ::handle<Interface_UndefinedContent> c = p->UndefinedContent();
      if (type == "GEOMETRIC_TOLERANCE") {
        gdt = true;
        unread.kind = "tolerance";
        if (!c.IsNull() && c->NbParams() >= 1 && !c->IsParamEntity(1)) {
          unread.name = unquoteStep(stepText(c->ParamValue(1)));
        }
        if (!c.IsNull() && c->NbParams() >= 4) {
          if (c->IsParamEntity(3)) unread.magnitude = c->ParamEntity(3);
          if (c->IsParamEntity(4)) unread.aspect = c->ParamEntity(4);
        }
      } else if (type == "GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE") {
        unread.datumReference = true;
      } else if (type == "DIMENSIONAL_SIZE" || type == "DIMENSIONAL_LOCATION") {
        gdt = true;
        unread.kind = "dimension";
      } else if (type.size() > 10 && type.compare(type.size() - 10, 10, "_TOLERANCE") == 0 &&
                 type.rfind("GEOMETRIC_TOLERANCE", 0) != 0) {
        unread.type = lowerWords(type.substr(0, type.size() - 10));
        unread.stepType = type;
      }
      if (!u->IsComplex()) break;
    }
    if (!gdt) continue;
    for (const std::string& p : parts) {
      if (p.rfind("GEOMETRIC_TOLERANCE_WITH_", 0) == 0) {
        if (!unread.why.empty()) unread.why += ", ";
        unread.why += lowerWords(p.substr(25));
      }
    }
    out.push_back(std::move(unread));
  }
  return out;
}

// --- Free shapes outside the bodies -----------------------------------------------------------

// TShapes of every face, edge and vertex of the document's free shapes (solids, and whatever a
// shape representation holds beside them: supplemental curves and surfaces).
std::set<const TopoDS_TShape*> documentSubShapes(const occ::handle<TDocStd_Document>& doc) {
  std::set<const TopoDS_TShape*> out;
  const occ::handle<XCAFDoc_ShapeTool> shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  NCollection_Sequence<TDF_Label> roots;
  shapes->GetFreeShapes(roots);
  for (int i = 1; i <= roots.Length(); ++i) {
    const TopoDS_Shape root = XCAFDoc_ShapeTool::GetShape(roots(i));
    if (root.IsNull()) continue;
    for (TopAbs_ShapeEnum kind : {TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX}) {
      for (TopExp_Explorer ex(root, kind); ex.More(); ex.Next()) out.insert(ex.Current().TShape().get());
    }
  }
  return out;
}
