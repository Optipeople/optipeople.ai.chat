-- kb_documents.folder_path — slash-separated folder path for the admin
-- tree UI. NULL = root. Purely organizational metadata; retrieval
-- happens at chunk level and ignores folders.

alter table kb_documents
  add column folder_path text;

create index kb_documents_folder_path_idx
  on kb_documents (machine_id, folder_path);
