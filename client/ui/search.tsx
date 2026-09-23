import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { Fragment, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  deleteQueryRpc,
  savedQueriesRpc,
  saveQueryRpc,
  searchRpc,
  type ItemKind,
  type ItemRef,
  type SearchQuery,
} from "../../shared/contract";
import { Button, errorText } from "./common";
import { ItemRow } from "./lists";
import type { Styles } from "./styles";

type Ui = { theme: PluginTheme; styles: Styles };

const SAVED_KEY = ["gitlab", "saved-queries"] as const;
const STATES: { id: SearchQuery["state"]; label: string }[] = [
  { id: "opened", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "merged", label: "Merged" },
  { id: "all", label: "All" },
];

function Segmented<T extends string>({ options, value, onChange, ui }: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ui: Ui;
}) {
  const { styles } = ui;
  return (
    <View style={styles.tabs}>
      {options.map((option) => (
        <Pressable
          key={option.id}
          accessibilityRole="tab"
          accessibilityState={{ selected: option.id === value }}
          onPress={() => onChange(option.id)}
          style={[styles.tab, option.id === value ? styles.tabActive : null]}
        >
          <Text style={[styles.tabLabel, option.id === value ? styles.tabLabelActive : null]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Search a project's issues and MRs by text, state, label, author and assignee,
 * and keep the searches you repeat as saved queries, like the custom queries of
 * GitLab's editor extensions.
 */
export function SearchPanel({ defaultProject, onOpen, ui }: {
  defaultProject: string;
  onOpen: (ref: ItemRef) => void;
  ui: Ui;
}) {
  const { styles, theme } = ui;
  const runSearch = useRpc(searchRpc);
  const readSaved = useRpc(savedQueriesRpc);
  const saveQuery = useRpc(saveQueryRpc);
  const deleteQuery = useRpc(deleteQueryRpc);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [form, setForm] = useState<SearchQuery>({
    kind: "mr",
    projectPath: defaultProject,
    search: "",
    state: "opened",
    label: "",
    author: "",
    assignee: "",
  });
  const [submitted, setSubmitted] = useState<SearchQuery | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const set = <K extends keyof SearchQuery>(key: K, value: SearchQuery[K]) => setForm((current) => ({ ...current, [key]: value }));

  const saved = useQuery({ queryKey: SAVED_KEY, queryFn: () => readSaved({}) });
  const results = useQuery({
    queryKey: ["gitlab", "search", submitted],
    queryFn: () => runSearch(submitted!),
    enabled: submitted !== null,
  });
  const save = useMutation({
    mutationFn: (name: string) => saveQuery({ ...form, name }),
    onSuccess: (data) => {
      queryClient.setQueryData(SAVED_KEY, data);
      setNaming(null);
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteQuery({ id }),
    onSuccess: (data) => queryClient.setQueryData(SAVED_KEY, data),
    onError: (error) => toast.error(errorText(error)),
  });

  const field = [styles.input, { minHeight: 0, flex: 1 }];
  const input = (key: "search" | "label" | "author" | "assignee" | "projectPath", placeholder: string) => (
    <TextInput
      value={form[key]}
      onChangeText={(value) => set(key, value)}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.foregroundMuted}
      onSubmitEditing={() => setSubmitted(form)}
      style={field}
    />
  );

  return (
    <View style={{ gap: 12 }}>
      {saved.data && saved.data.queries.length > 0 ? (
        <View style={[styles.chips, { alignItems: "center" }]}>
          {saved.data.queries.map((query) => (
            <View key={query.id} style={[styles.badge, styles.row, { gap: 6 }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Run ${query.name}`}
                onPress={() => {
                  const { id: _id, name: _name, ...rest } = query;
                  setForm(rest);
                  setSubmitted(rest);
                }}
              >
                <Text style={styles.badgeLabel}>{query.name}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${query.name}`} onPress={() => remove.mutate(query.id)}>
                <Text style={styles.badgeLabel}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.card}>
        <View style={styles.cardBody}>
          <Segmented<ItemKind>
            options={[
              { id: "mr", label: "Merge requests" },
              { id: "issue", label: "Issues" },
            ]}
            value={form.kind}
            onChange={(kind) => set("kind", kind)}
            ui={ui}
          />
          <View style={styles.row}>{input("search", "Title or description contains…")}</View>
          <Segmented options={STATES} value={form.state} onChange={(state) => set("state", state)} ui={ui} />
          <View style={styles.row}>
            {input("author", "Author")}
            {input("assignee", "Assignee")}
          </View>
          <View style={styles.row}>{input("label", "Labels, comma separated")}</View>
          <View style={styles.row}>{input("projectPath", "Project path")}</View>
          <View style={[styles.row, { flexWrap: "wrap" }]}>
            {naming !== null ? (
              <>
                <TextInput
                  value={naming}
                  onChangeText={setNaming}
                  placeholder="Name this query"
                  placeholderTextColor={theme.colors.foregroundMuted}
                  autoFocus
                  style={field}
                />
                <Button label="Cancel" onPress={() => setNaming(null)} styles={styles} theme={theme} />
                <Button
                  label="Save"
                  busy={save.isPending}
                  disabled={!naming.trim()}
                  onPress={() => save.mutate(naming.trim())}
                  styles={styles}
                  theme={theme}
                />
              </>
            ) : (
              <>
                <Button label="Save query" onPress={() => setNaming("")} styles={styles} theme={theme} />
                <View style={styles.spacer} />
                <Button
                  label="Search"
                  primary
                  disabled={!form.projectPath.trim()}
                  onPress={() => setSubmitted(form)}
                  styles={styles}
                  theme={theme}
                />
              </>
            )}
          </View>
        </View>
      </View>
      {submitted ? (
        <View style={styles.card}>
          {results.isPending ? (
            <Text style={[styles.muted, { padding: 12 }]}>Searching…</Text>
          ) : results.isError ? (
            <Text style={[styles.error, { padding: 12 }]}>{errorText(results.error)}</Text>
          ) : results.data.items.length === 0 ? (
            <Text style={[styles.muted, { padding: 12 }]}>Nothing matches.</Text>
          ) : (
            results.data.items.map((item, index) => (
              <Fragment key={item.reference}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <ItemRow item={item} onOpen={onOpen} ui={ui} />
              </Fragment>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}
